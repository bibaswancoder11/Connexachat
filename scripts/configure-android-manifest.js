import fs from 'fs';
import path from 'path';

const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

console.log('Checking AndroidManifest at:', manifestPath);

if (!fs.existsSync(manifestPath)) {
  console.log('AndroidManifest.xml not found yet. It will be configured during APK build workflow.');
  process.exit(0);
}

let content = fs.readFileSync(manifestPath, 'utf8');

// 1. Required Android Permissions for Connexa (Audio, Camera, Media Gallery, Notifications, Network)
const permissionsToAdd = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.CAMERA',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.SCHEDULE_EXACT_ALARM'
];

permissionsToAdd.forEach(perm => {
  if (!content.includes(perm)) {
    content = content.replace(
      /<manifest([^>]*)>/,
      `<manifest$1>\n    <uses-permission android:name="${perm}" />`
    );
  }
});

// 2. Hardware features (Camera & Mic optional so all Android devices can install)
const featuresToAdd = [
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />'
];

featuresToAdd.forEach(feat => {
  const featName = feat.match(/android:name="([^"]+)"/)?.[1];
  if (featName && !content.includes(featName)) {
    content = content.replace(
      /<manifest([^>]*)>/,
      `<manifest$1>\n    ${feat}`
    );
  }
});

// 3. Application Attributes (requestLegacyExternalStorage, usesCleartextTraffic)
if (!content.includes('android:requestLegacyExternalStorage="true"')) {
  content = content.replace('<application', '<application android:requestLegacyExternalStorage="true"');
}

// 4. Intent Filters for Android Native Share Sheet Target (Links, Text, Photos, Videos, Documents, Any File)
const shareIntentFilter = `
            <!-- Native Android Share Sheet Target (WhatsApp Style - Links, Documents, Photos, Videos, Audio, Any File) -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="text/*" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="application/*" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="application/*" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="connexa" />
            </intent-filter>`;

if (!content.includes('android.intent.action.SEND_MULTIPLE') || !content.includes('android:mimeType="application/*"')) {
  // Replace old or insert new
  content = content.replace(
    '</activity>',
    `${shareIntentFilter}\n        </activity>`
  );
}

// 5. FCM Push Notification metadata inside <application>
const fcmMetadata = `
        <!-- Firebase Cloud Messaging Push Notification Default Configuration -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="connexa_messages_channel" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@mipmap/ic_launcher" />`;

if (!content.includes('com.google.firebase.messaging.default_notification_channel_id')) {
  content = content.replace(
    '</application>',
    `${fcmMetadata}\n    </application>`
  );
}

fs.writeFileSync(manifestPath, content, 'utf8');
console.log('✅ AndroidManifest.xml successfully configured with media permissions, features, FCM push metadata, and universal native share sheet intent filters!');

// 6. Configure MainActivity.java to intercept ACTION_SEND and ACTION_SEND_MULTIPLE intents (Links, Files, Media, Text)
function findMainActivity(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const res = findMainActivity(full);
      if (res) return res;
    } else if (f === 'MainActivity.java') {
      return full;
    }
  }
  return null;
}

const javaDir = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'java');
const mainActivityPath = findMainActivity(javaDir);

if (mainActivityPath && fs.existsSync(mainActivityPath)) {
  let mainContent = fs.readFileSync(mainActivityPath, 'utf8');
  if (!mainContent.includes('handleUniversalShareIntent')) {
    // Add required imports
    const requiredImports = `import com.getcapacitor.BridgeActivity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.database.Cursor;
import android.provider.OpenableColumns;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;`;

    mainContent = mainContent.replace(
      'import com.getcapacitor.BridgeActivity;',
      requiredImports
    );

    const shareHandlingMethods = `
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleUniversalShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUniversalShareIntent(intent);
    }

    private void handleUniversalShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            handleSingleShare(intent, type);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type != null) {
            handleMultipleShare(intent, type);
        }
    }

    private void handleSingleShare(Intent intent, String type) {
        try {
            Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);

            JSONObject payload = new JSONObject();
            payload.put("source", "android-share-sheet");

            if (streamUri != null) {
                // File/Media shared via EXTRA_STREAM
                JSONObject item = uriToShareItem(streamUri, type);
                if (item != null) {
                    JSONArray items = new JSONArray();
                    items.put(item);
                    payload.put("items", items);
                    payload.put("type", type.startsWith("image/") || type.startsWith("video/") ? "media" : "file");
                    payload.put("caption", sharedText != null ? sharedText : "");
                    payload.put("text", sharedText != null ? sharedText : "");
                    passPayloadToWebView(payload);
                    return;
                }
            }

            // Text or URL only
            if (sharedText != null && !sharedText.isEmpty()) {
                payload.put("text", sharedText);
                payload.put("caption", sharedText);
                if (sharedTitle != null) payload.put("title", sharedTitle);

                // Detect if it is a link
                if (sharedText.contains("http://") || sharedText.contains("https://")) {
                    payload.put("type", "link");
                    payload.put("url", extractUrlFromText(sharedText));
                } else {
                    payload.put("type", "text");
                }
                passPayloadToWebView(payload);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleMultipleShare(Intent intent, String type) {
        try {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (uris != null && !uris.isEmpty()) {
                JSONObject payload = new JSONObject();
                payload.put("source", "android-share-sheet");
                payload.put("type", type.startsWith("image/") || type.startsWith("video/") ? "media" : "file");
                payload.put("caption", sharedText != null ? sharedText : "");
                payload.put("text", sharedText != null ? sharedText : "");

                JSONArray items = new JSONArray();
                for (Uri u : uris) {
                    JSONObject item = uriToShareItem(u, type);
                    if (item != null) items.put(item);
                }
                payload.put("items", items);
                passPayloadToWebView(payload);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private JSONObject uriToShareItem(Uri uri, String mimeType) {
        try {
            String filename = "shared_file";
            long size = 0;

            Cursor cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (cursor.moveToFirst()) {
                    if (nameIndex != -1) filename = cursor.getString(nameIndex);
                    if (sizeIndex != -1) size = cursor.getLong(sizeIndex);
                }
                cursor.close();
            }

            // Determine specific mime type if generic
            String actualMime = getContentResolver().getType(uri);
            if (actualMime == null) actualMime = mimeType;

            String itemType = "file";
            if (actualMime != null) {
                if (actualMime.startsWith("image/")) itemType = "image";
                else if (actualMime.startsWith("video/")) itemType = "video";
            }

            // Read file into Base64 Data URL (for files up to 25MB)
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return null;

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int nRead;
            byte[] data = new byte[16384];
            while ((nRead = is.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, nRead);
            }
            buffer.flush();
            byte[] fileBytes = buffer.toByteArray();
            is.close();

            String base64Data = Base64.encodeToString(fileBytes, Base64.NO_WRAP);
            String dataUrl = "data:" + (actualMime != null ? actualMime : "application/octet-stream") + ";base64," + base64Data;

            JSONObject obj = new JSONObject();
            obj.put("type", itemType);
            obj.put("dataUrl", dataUrl);
            obj.put("filename", filename);
            obj.put("size", size > 0 ? size : fileBytes.length);
            obj.put("mimeType", actualMime);
            return obj;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private String extractUrlFromText(String text) {
        if (text == null) return "";
        int start = text.indexOf("http://");
        if (start == -1) start = text.indexOf("https://");
        if (start == -1) return text;
        int end = text.indexOf(" ", start);
        if (end == -1) end = text.indexOf("\\n", start);
        if (end == -1) return text.substring(start);
        return text.substring(start, end);
    }

    private void passPayloadToWebView(JSONObject payload) {
        try {
            String jsonStr = payload.toString();
            String js = "(function(){ " +
                "try { localStorage.setItem('connexa_pending_universal_share', JSON.stringify(" + jsonStr + ")); } catch(e){} " +
                "window.dispatchEvent(new CustomEvent('connexa:universal-share', { detail: " + jsonStr + " })); " +
                "})();";

            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().post(() -> {
                    this.bridge.getWebView().evaluateJavascript(js, null);
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
`;

    mainContent = mainContent.replace(
      /public class MainActivity extends BridgeActivity\s*\{/,
      `public class MainActivity extends BridgeActivity {\n${shareHandlingMethods}`
    );

    fs.writeFileSync(mainActivityPath, mainContent, 'utf8');
    console.log('✅ MainActivity.java successfully configured with universal native ACTION_SEND and ACTION_SEND_MULTIPLE intent handlers!');
  }
}

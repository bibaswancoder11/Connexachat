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

// 3. Application & MainActivity Attributes (ensure exported="true", largeHeap="true" for 55MB media, and Share Sheet intents)
if (!content.includes('android:requestLegacyExternalStorage="true"')) {
  content = content.replace('<application', '<application android:requestLegacyExternalStorage="true"');
}

if (!content.includes('android:largeHeap="true"')) {
  content = content.replace('<application', '<application android:largeHeap="true"');
}

if (content.includes('android:exported="false"')) {
  content = content.replace('android:exported="false"', 'android:exported="true"');
} else if (!content.includes('android:exported="true"')) {
  content = content.replace('<activity', '<activity android:exported="true"');
}

// 4. Intent Filters for Android Native Share Sheet Target (Links, Text, Photos, Videos, Documents, PDFs, Audio, Any File)
const shareIntentFilter = `
            <!-- Native Android Share Sheet Target (WhatsApp Style - Links, Documents, Photos, Videos, Audio, Any File) -->
            <intent-filter android:label="Connexa">
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="text/*" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/*" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter android:label="Connexa">
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/*" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="connexa" />
            </intent-filter>`;

if (!content.includes('android.intent.action.SEND_MULTIPLE') || !content.includes('android:mimeType="application/pdf"')) {
  // Remove previous share intent filter block if upgrading
  content = content.replace(
    /\s*<!-- Native Android Share Sheet Target[\s\S]*?<data android:scheme="connexa" \/>\s*<\/intent-filter>/,
    ''
  );
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
console.log('✅ AndroidManifest.xml configured with exported MainActivity, media permissions, FCM metadata, and universal share sheet filters!');

// 6. Configure MainActivity.java with @JavascriptInterface Bridge + Async Stream/ClipData Reader
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
  const existingMain = fs.readFileSync(mainActivityPath, 'utf8');
  const pkgMatch = existingMain.match(/package\s+([a-zA-Z0-9_.]+)\s*;/);
  const packageName = pkgMatch ? pkgMatch[1] : 'com.connexa.messenger';

  if (!existingMain.includes('getSharedFileChunkBase64')) {
    const updatedMainActivityJava = `package ${packageName};

import com.getcapacitor.BridgeActivity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    private static final long MAX_SHARED_FILE_BYTES = 55L * 1024L * 1024L; // 55 MB limit
    private volatile String pendingSharedPayloadJson = null;
    private final ExecutorService shareExecutor = Executors.newSingleThreadExecutor();

    private File getShareCacheDir() {
        File dir = new File(getCacheDir(), "connexa_shared_cache");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    public class ConnexaShareBridge {
        @JavascriptInterface
        public boolean hasPendingShare() {
            return pendingSharedPayloadJson != null && !pendingSharedPayloadJson.isEmpty();
        }

        @JavascriptInterface
        public String consumePendingShare() {
            String payload = pendingSharedPayloadJson;
            pendingSharedPayloadJson = null;
            return payload;
        }

        @JavascriptInterface
        public String getSharedFileChunkBase64(String fileId, double offsetDouble, int length) {
            try {
                if (fileId == null || fileId.contains("/") || fileId.contains("\\\\") || fileId.contains("..")) {
                    return "";
                }
                File target = new File(getShareCacheDir(), fileId);
                if (!target.exists()) return "";
                long offset = (long) offsetDouble;
                long fileLen = target.length();
                if (offset < 0 || offset >= fileLen || length <= 0) return "";

                int toRead = (int) Math.min((long) length, fileLen - offset);
                byte[] buf = new byte[toRead];
                RandomAccessFile raf = new RandomAccessFile(target, "r");
                try {
                    raf.seek(offset);
                    int actual = raf.read(buf, 0, toRead);
                    if (actual <= 0) return "";
                    if (actual < toRead) {
                        byte[] exact = new byte[actual];
                        System.arraycopy(buf, 0, exact, 0, actual);
                        return Base64.encodeToString(exact, Base64.NO_WRAP);
                    }
                    return Base64.encodeToString(buf, Base64.NO_WRAP);
                } finally {
                    raf.close();
                }
            } catch (Exception e) {
                e.printStackTrace();
                return "";
            }
        }

        @JavascriptInterface
        public void deleteSharedTempFile(String fileId) {
            try {
                if (fileId == null || fileId.contains("/") || fileId.contains("\\\\") || fileId.contains("..")) {
                    return;
                }
                File target = new File(getShareCacheDir(), fileId);
                if (target.exists()) {
                    target.delete();
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            webView.addJavascriptInterface(new ConnexaShareBridge(), "ConnexaAndroidShare");
        }
        handleUniversalShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUniversalShareIntent(intent);
    }

    private void handleUniversalShareIntent(final Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();
        final String type = intent.getType() != null ? intent.getType() : "*/*";

        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        final Set<Uri> uriSet = new LinkedHashSet<>();

        if (Intent.ACTION_SEND.equals(action)) {
            Uri singleUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (singleUri != null) {
                uriSet.add(singleUri);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> multiUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multiUris != null) {
                for (Uri u : multiUris) {
                    if (u != null) uriSet.add(u);
                }
            }
        }

        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                ClipData.Item clipItem = clipData.getItemAt(i);
                if (clipItem != null && clipItem.getUri() != null) {
                    uriSet.add(clipItem.getUri());
                }
            }
        }

        final String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        final String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);

        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.setClipData(null);

        shareExecutor.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("source", "android-share-sheet");
                if (sharedTitle != null && !sharedTitle.trim().isEmpty()) {
                    payload.put("title", sharedTitle.trim());
                }

                if (!uriSet.isEmpty()) {
                    JSONArray items = new JSONArray();
                    boolean allFilesAreDocs = true;

                    for (Uri u : uriSet) {
                        JSONObject item = uriToShareItem(u, type);
                        if (item != null) {
                            String itemType = item.optString("type", "file");
                            if ("image".equals(itemType) || "video".equals(itemType)) {
                                allFilesAreDocs = false;
                            }
                            items.put(item);
                        }
                    }

                    if (items.length() > 0) {
                        payload.put("items", items);
                        payload.put("type", allFilesAreDocs ? "file" : "media");
                        String cleanCaption = sharedText != null ? sharedText.trim() : "";
                        payload.put("caption", cleanCaption);
                        payload.put("text", cleanCaption);
                        deliverPayloadToWebView(payload);
                        return;
                    }
                }

                if (sharedText != null && !sharedText.trim().isEmpty()) {
                    String trimmed = sharedText.trim();
                    String extractedUrl = extractUrlFromText(trimmed);

                    if (!extractedUrl.isEmpty()) {
                        payload.put("type", "link");
                        payload.put("url", extractedUrl);
                        String remainingCaption = trimmed.replace(extractedUrl, "").trim();
                        payload.put("caption", remainingCaption);
                        payload.put("text", remainingCaption);
                    } else {
                        payload.put("type", "text");
                        payload.put("caption", trimmed);
                        payload.put("text", trimmed);
                    }
                    deliverPayloadToWebView(payload);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    private JSONObject uriToShareItem(Uri uri, String fallbackMimeType) {
        try {
            String filename = "shared_file";
            long declaredSize = 0;

            Cursor cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null) {
                try {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (cursor.moveToFirst()) {
                        if (nameIndex != -1 && cursor.getString(nameIndex) != null) {
                            filename = cursor.getString(nameIndex);
                        }
                        if (sizeIndex != -1) {
                            declaredSize = cursor.getLong(sizeIndex);
                        }
                    }
                } finally {
                    cursor.close();
                }
            }

            String actualMime = getContentResolver().getType(uri);
            if (actualMime == null || actualMime.equals("*/*")) {
                actualMime = fallbackMimeType;
            }
            if (actualMime == null || actualMime.equals("*/*")) {
                actualMime = guessMimeFromFilename(filename);
            }

            String lowerMime = actualMime.toLowerCase();
            String lowerName = filename.toLowerCase();
            String itemType = "file";
            if (lowerMime.startsWith("image/") || lowerName.matches(".*\\\\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$")) {
                itemType = "image";
            } else if (lowerMime.startsWith("video/") || lowerName.matches(".*\\\\.(mp4|webm|mov|mkv|avi|m4v|3gp)$")) {
                itemType = "video";
            }

            if (declaredSize > MAX_SHARED_FILE_BYTES) {
                JSONObject tooLarge = new JSONObject();
                tooLarge.put("type", itemType);
                tooLarge.put("dataUrl", "");
                tooLarge.put("filename", filename);
                tooLarge.put("size", declaredSize);
                tooLarge.put("mimeType", actualMime);
                tooLarge.put("error", ("video".equals(itemType) ? "Video" : "File") + " exceeds the 55MB sharing limit.");
                return tooLarge;
            }

            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return null;

            String tempFileId = "share_" + UUID.randomUUID().toString() + ".bin";
            File outFile = new File(getShareCacheDir(), tempFileId);
            long totalWritten = 0;
            boolean exceededLimit = false;

            FileOutputStream fos = new FileOutputStream(outFile);
            try {
                byte[] buffer = new byte[65536];
                int nRead;
                while ((nRead = is.read(buffer, 0, buffer.length)) != -1) {
                    totalWritten += nRead;
                    if (totalWritten > MAX_SHARED_FILE_BYTES) {
                        exceededLimit = true;
                        break;
                    }
                    fos.write(buffer, 0, nRead);
                }
                fos.flush();
            } finally {
                try { fos.close(); } catch (Exception ignored) {}
                try { is.close(); } catch (Exception ignored) {}
            }

            if (exceededLimit) {
                outFile.delete();
                JSONObject tooLarge = new JSONObject();
                tooLarge.put("type", itemType);
                tooLarge.put("dataUrl", "");
                tooLarge.put("filename", filename);
                tooLarge.put("size", totalWritten);
                tooLarge.put("mimeType", actualMime);
                tooLarge.put("error", ("video".equals(itemType) ? "Video" : "File") + " exceeds the 55MB sharing limit.");
                return tooLarge;
            }

            JSONObject obj = new JSONObject();
            obj.put("type", itemType);
            obj.put("dataUrl", "");
            obj.put("nativeFileId", tempFileId);
            obj.put("filename", filename);
            obj.put("size", totalWritten > 0 ? totalWritten : declaredSize);
            obj.put("mimeType", actualMime);
            return obj;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private String guessMimeFromFilename(String filename) {
        if (filename == null) return "application/octet-stream";
        String lower = filename.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
        if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".3gp")) return "video/3gpp";
        return "application/octet-stream";
    }

    private String extractUrlFromText(String text) {
        if (text == null) return "";
        int start = text.indexOf("https://");
        if (start == -1) start = text.indexOf("http://");
        if (start == -1) return "";
        int end = start;
        while (end < text.length() && !Character.isWhitespace(text.charAt(end))) {
            end++;
        }
        return text.substring(start, end);
    }

    private void deliverPayloadToWebView(JSONObject payload) {
        pendingSharedPayloadJson = payload.toString();
        notifyWebViewBridgeReady(0);
        notifyWebViewBridgeReady(400);
        notifyWebViewBridgeReady(1200);
        notifyWebViewBridgeReady(2500);
    }

    private void notifyWebViewBridgeReady(long delayMs) {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        final WebView webView = this.bridge.getWebView();
        webView.postDelayed(() -> {
            if (pendingSharedPayloadJson != null) {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('connexa:native-share-ready'));",
                    null
                );
            }
        }, delayMs);
    }
}
`;

    fs.writeFileSync(mainActivityPath, updatedMainActivityJava, 'utf8');
    console.log('✅ MainActivity.java configured with 55MB streaming ConnexaAndroidShare @JavascriptInterface bridge!');
  }
}

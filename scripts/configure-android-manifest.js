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

// 4. Intent Filters for Android Share Sheet Target (SEND and SEND_MULTIPLE) & Deep Links
const shareIntentFilter = `
            <!-- Native Android Share Sheet Target (Links, Text, Photos & Videos) -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="text/*" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="video/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="connexa" />
            </intent-filter>`;

if (!content.includes('android.intent.action.SEND_MULTIPLE')) {
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
console.log('✅ AndroidManifest.xml successfully configured with media permissions, features, FCM push metadata, and native share sheet intent filters!');

// 6. Configure MainActivity.java to intercept ACTION_SEND intents (from YouTube, Gallery, etc.)
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
  if (!mainContent.includes('handleShareIntent')) {
    // Add imports
    if (!mainContent.includes('import android.content.Intent;')) {
      mainContent = mainContent.replace(
        'import com.getcapacitor.BridgeActivity;',
        'import com.getcapacitor.BridgeActivity;\nimport android.content.Intent;\nimport android.os.Bundle;\nimport org.json.JSONObject;'
      );
    }

    const shareHandlingMethods = `
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if (type.startsWith("text/")) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                if (sharedText != null && !sharedText.isEmpty()) {
                    passSharedTextToWebView(sharedText, sharedTitle);
                }
            }
        }
    }

    private void passSharedTextToWebView(String text, String title) {
        try {
            String escapedText = JSONObject.quote(text);
            String escapedTitle = title != null ? JSONObject.quote(title) : "null";
            String js = "(function(){ " +
                "try { localStorage.setItem('connexa_pending_share_link', JSON.stringify({ text: " + escapedText + ", title: " + escapedTitle + " })); } catch(e){} " +
                "window.dispatchEvent(new CustomEvent('connexa:share-link', { detail: { text: " + escapedText + ", title: " + escapedTitle + " } })); " +
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
    console.log('✅ MainActivity.java successfully configured with native ACTION_SEND intent handlers!');
  }
}

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

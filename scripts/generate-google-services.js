import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const androidAppDir = path.join(process.cwd(), 'android', 'app');
const targetPath = path.join(androidAppDir, 'google-services.json');

if (!fs.existsSync(androidAppDir)) {
  console.log('android/app directory does not exist yet. google-services.json will be generated during Android build.');
  process.exit(0);
}

let firebaseConfig = {
  projectId: 'gen-lang-client-0913552592',
  appId: '1:1077516625864:web:e743ee180ae27a1e1942fd',
  messagingSenderId: '1077516625864',
  apiKey: 'AIzaSyDPSwk9Y0Ad3pP5nvin61ZuuzNxdgJ4nZU',
  storageBucket: 'gen-lang-client-0913552592.firebasestorage.app'
};

try {
  const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    firebaseConfig = { ...firebaseConfig, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
  }
} catch (err) {
  console.warn('Could not read firebase-applet-config.json, using defaults:', err);
}

const senderId = String(firebaseConfig.messagingSenderId || '1077516625864').replace(/\D/g, '') || '1077516625864';

// Firebase Android SDK expects a valid hex app hash in 1:<project_number>:android:<hex_id>
let hexSuffix = '';
if (typeof firebaseConfig.appId === 'string') {
  const parts = firebaseConfig.appId.split(':');
  const candidate = parts[parts.length - 1] || '';
  if (/^[0-9a-f]{16,32}$/i.test(candidate)) {
    hexSuffix = candidate.toLowerCase();
  }
}
if (!hexSuffix) {
  hexSuffix = crypto.createHash('sha1').update('com.connexa.messenger').digest('hex').slice(0, 22);
}

const mobileSdkAppId =
  typeof firebaseConfig.androidAppId === 'string' && /^1:\d+:android:[0-9a-f]+$/i.test(firebaseConfig.androidAppId)
    ? firebaseConfig.androidAppId
    : `1:${senderId}:android:${hexSuffix}`;

const googleServicesData = {
  project_info: {
    project_number: senderId,
    project_id: firebaseConfig.projectId || 'gen-lang-client-0913552592',
    storage_bucket: firebaseConfig.storageBucket || `${firebaseConfig.projectId}.firebasestorage.app`
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: mobileSdkAppId,
        android_client_info: {
          package_name: 'com.connexa.messenger'
        }
      },
      oauth_client: [],
      api_key: [
        {
          current_key: firebaseConfig.apiKey || ''
        }
      ],
      services: {
        appinvite_service: {
          other_platform_oauth_client: []
        }
      }
    }
  ],
  configuration_version: '1'
};

fs.writeFileSync(targetPath, JSON.stringify(googleServicesData, null, 2), 'utf8');
console.log(`✅ Generated android/app/google-services.json (mobilesdk_app_id: ${mobileSdkAppId})!`);

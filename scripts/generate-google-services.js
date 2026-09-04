import fs from 'fs';
import path from 'path';

const androidAppDir = path.join(process.cwd(), 'android', 'app');
const targetPath = path.join(androidAppDir, 'google-services.json');

if (!fs.existsSync(androidAppDir)) {
  console.log('android/app directory does not exist yet. google-services.json will be generated during Android build.');
  process.exit(0);
}

let firebaseConfig = {
  projectId: 'gen-lang-client-0913552592',
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

const googleServicesData = {
  project_info: {
    project_number: firebaseConfig.messagingSenderId || '1077516625864',
    project_id: firebaseConfig.projectId || 'gen-lang-client-0913552592',
    storage_bucket: firebaseConfig.storageBucket || `${firebaseConfig.projectId}.firebasestorage.app`
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: `1:${firebaseConfig.messagingSenderId || '1077516625864'}:android:com.connexa.messenger`,
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
console.log('✅ Generated android/app/google-services.json for Firebase Cloud Messaging (FCM)!');

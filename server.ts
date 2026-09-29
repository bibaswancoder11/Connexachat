import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import webpush from 'web-push';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Fallback Web Share Target POST handler (in case request reaches Express directly without SW interception)
app.post(['/', '/share-target', '/index.html'], (req, res) => {
  const url = (req.body?.url || req.query?.url || '').toString();
  const text = (req.body?.text || req.query?.text || '').toString();
  const title = (req.body?.title || req.query?.title || '').toString();

  const sp = new URLSearchParams();
  if (url) sp.set('shared_url', url);
  if (text) sp.set('shared_text', text);
  if (title) sp.set('shared_title', title);

  const queryStr = sp.toString();
  return res.redirect(303, queryStr ? `/?${queryStr}` : '/');
});

// Read Firebase applet configuration
let firebaseConfig: any = {};
try {
  const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
} catch (e) {
  console.warn('Could not read firebase-applet-config.json:', e);
}

// Manage Persistent VAPID Keys for Web Push
const VAPID_PATH = path.join(process.cwd(), 'vapid-keys.json');
let vapidKeys = {
  publicKey: '',
  privateKey: ''
};

try {
  if (fs.existsSync(VAPID_PATH)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_PATH, JSON.stringify(vapidKeys, null, 2), 'utf8');
    console.log('Generated new persistent VAPID keypair for Web Push.');
  }

  webpush.setVapidDetails(
    'mailto:support@connexa.messenger',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('Web Push VAPID configured successfully with public key:', vapidKeys.publicKey.slice(0, 15) + '...');
} catch (err) {
  console.warn('Failed to initialize Web Push VAPID:', err);
}

// 1. Health API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// 2. High-Performance WebRTC ICE & TURN Relay Gateway API
app.get('/api/ice-servers', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const customTurn = process.env.TURN_URL ? [{
    urls: process.env.TURN_URL.split(',').map(u => u.trim()),
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || ''
  }] : [];

  res.json({
    iceServers: [
      // Primary Tier: Google Multi-Region STUN
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Secondary Tier: Cloudflare STUN
      { urls: 'stun:stun.cloudflare.com:3478' },
      // Tertiary Tier: OpenRelay Global Multi-Port TURN (UDP, TCP, and TLS Port 443 for Carrier NAT Bypass)
      {
        urls: [
          'stun:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turns:openrelay.metered.ca:443?transport=tcp'
        ],
        username: process.env.TURN_USERNAME || 'openrelayproject',
        credential: process.env.TURN_CREDENTIAL || 'openrelayproject'
      },
      ...customTurn
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });
});

// 3. Call Ping / Latency Diagnostic API
app.get('/api/call/ping', (req, res) => {
  res.json({ pong: true, time: Date.now() });
});

// 4. VAPID Public Key API
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// 3. Helper to fetch user tokens & subscriptions via Firestore REST
async function fetchRecipientTokensFromFirestore(uid: string): Promise<{
  subscriptions: any[];
  fcmTokens: string[];
}> {
  const result = {
    subscriptions: [] as any[],
    fcmTokens: [] as string[]
  };

  if (!firebaseConfig.projectId || !firebaseConfig.firestoreDatabaseId) {
    return result;
  }

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${uid}?key=${firebaseConfig.apiKey}`;
    const resp = await fetch(firestoreUrl);
    if (!resp.ok) return result;

    const data = await resp.json();
    const fields = data.fields || {};

    // Extract pushSubscriptions map
    if (fields.pushSubscriptions?.mapValue?.fields) {
      const subsMap = fields.pushSubscriptions.mapValue.fields;
      for (const key of Object.keys(subsMap)) {
        const subObj = subsMap[key]?.mapValue?.fields;
        if (subObj?.endpoint?.stringValue) {
          result.subscriptions.push({
            endpoint: subObj.endpoint.stringValue,
            keys: {
              p256dh: subObj.keys?.mapValue?.fields?.p256dh?.stringValue || '',
              auth: subObj.keys?.mapValue?.fields?.auth?.stringValue || ''
            }
          });
        }
      }
    }

    // Extract pushTokens map (Android FCM / Native)
    if (fields.pushTokens?.mapValue?.fields) {
      const tokensMap = fields.pushTokens.mapValue.fields;
      for (const key of Object.keys(tokensMap)) {
        const tokObj = tokensMap[key]?.mapValue?.fields;
        const tokStr = tokObj?.token?.stringValue || key;
        if (tokStr) {
          result.fcmTokens.push(tokStr);
        }
      }
    }
  } catch (err) {
    console.warn(`Error fetching Firestore tokens for ${uid}:`, err);
  }

  return result;
}

// 4. Send Push Notification API (Handles both Native Android & Web Push)
app.post('/api/send-push', async (req, res) => {
  try {
    const {
      recipientUids = [],
      title = 'Connexa Messenger',
      body = 'You have a new message',
      icon,
      badge,
      data = {},
      recipientTokens = [],
      recipientSubscriptions = []
    } = req.body;

    const allSubscriptions: any[] = [...recipientSubscriptions];
    const allFcmTokens: string[] = [...recipientTokens];

    // Fetch stored tokens from Firestore for each recipient if UIDs provided
    if (Array.isArray(recipientUids) && recipientUids.length > 0) {
      await Promise.all(
        recipientUids.map(async (uid: string) => {
          const fetched = await fetchRecipientTokensFromFirestore(uid);
          allSubscriptions.push(...fetched.subscriptions);
          allFcmTokens.push(...fetched.fcmTokens);
        })
      );
    }

    const payloadString = JSON.stringify({
      title,
      body,
      icon: icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
      badge: badge || icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
      tag: data.chatId ? `connexa-chat-${data.chatId}` : 'connexa-msg',
      data: {
        ...data,
        receivedAt: Date.now()
      }
    });

    let webPushedCount = 0;
    let fcmPushedCount = 0;

    // A. Dispatch Web Push notifications via web-push
    const uniqueSubs = Array.from(
      new Map(allSubscriptions.map(s => [s.endpoint, s])).values()
    );

    await Promise.all(
      uniqueSubs.map(async (sub) => {
        if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
        try {
          await webpush.sendNotification(sub, payloadString, {
            TTL: 60 * 60 * 24, // 24 hours
            urgency: 'high'
          });
          webPushedCount++;
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log('Expired Web Push subscription endpoint:', sub.endpoint.slice(0, 35));
          } else {
            console.warn('Web push dispatch error:', err.message || err);
          }
        }
      })
    );

    // B. Dispatch to Android FCM devices
    const uniqueFcmTokens = Array.from(new Set(allFcmTokens));
    if (uniqueFcmTokens.length > 0 && firebaseConfig.apiKey) {
      await Promise.all(
        uniqueFcmTokens.map(async (token) => {
          try {
            // FCM Legacy / Direct Endpoint
            const fcmResp = await fetch('https://fcm.googleapis.com/fcm/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `key=${firebaseConfig.apiKey}`
              },
              body: JSON.stringify({
                to: token,
                priority: 'high',
                notification: {
                  title,
                  body,
                  sound: 'default',
                  icon: 'ic_launcher',
                  click_action: 'OPEN_CHAT',
                  channel_id: 'connexa_messages_channel'
                },
                data: {
                  ...data,
                  title,
                  body
                }
              })
            });

            if (fcmResp.ok) {
              fcmPushedCount++;
            }
          } catch (fcmErr) {
            console.warn('FCM dispatch error for token:', fcmErr);
          }
        })
      );
    }

    res.json({
      success: true,
      webPushedCount,
      fcmPushedCount,
      totalRecipients: recipientUids.length
    });
  } catch (err: any) {
    console.error('Push notification endpoint error:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch push notification' });
  }
});

// Vite middleware for development & Static serving in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.all('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Connexa High-Performance Server running on http://localhost:${PORT}`);
  });

  // Optimize server keep-alive timeouts to prevent connection drops on cellular / mobile
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer();

import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import webpush from 'web-push';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const MAX_SHARED_BYTES = 55 * 1024 * 1024; // 55 MB

app.use(
  compression({
    filter: (req, res) => {
      if (req.path?.startsWith('/api/shared-temp/')) {
        return false;
      }
      return compression.filter(req, res);
    }
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

interface TempSharedFile {
  filePath: string;
  mimeType: string;
  filename: string;
  size: number;
  expiresAt: number;
}
const tempSharedFiles = new Map<string, TempSharedFile>();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of tempSharedFiles.entries()) {
    if (entry.expiresAt <= now) {
      tempSharedFiles.delete(id);
      fs.promises.unlink(entry.filePath).catch(() => {});
    }
  }
}, 60000).unref();

app.get('/api/shared-temp/:fileId', (req, res) => {
  const { fileId } = req.params;
  const shouldConsume = req.query.consume === '1';
  const entry = tempSharedFiles.get(fileId);
  if (!entry || !fs.existsSync(entry.filePath)) {
    return res.status(404).json({ error: 'Shared temporary file expired or not found.' });
  }
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Content-Length', String(entry.size));
  res.setHeader('Cache-Control', 'no-store');
  const stream = fs.createReadStream(entry.filePath);
  res.on('finish', () => {
    if (shouldConsume) {
      tempSharedFiles.delete(fileId);
      fs.promises.unlink(entry.filePath).catch(() => {});
    }
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

// Fallback Web Share Target POST handler (supports videos & files up to 55MB if cold-launched POST reaches Express before SW intercepts)
app.post(['/', '/share-target', '/index.html'], async (req, res) => {
  try {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('multipart/form-data')) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers.host || `localhost:${PORT}`;
      const webReq = new Request(`${protocol}://${host}${req.originalUrl}`, {
        method: 'POST',
        headers: req.headers as Record<string, string>,
        body: Readable.toWeb(req) as any,
        // @ts-ignore - Node fetch duplex stream option
        duplex: 'half'
      });

      const formData = await webReq.formData();
      const title = (formData.get('title') || '').toString().trim();
      const text = (formData.get('text') || '').toString().trim();
      const url = (formData.get('url') || '').toString().trim();

      const items: Array<{
        type: 'image' | 'video' | 'file';
        dataUrl: string;
        tempFileUrl?: string;
        filename: string;
        size: number;
        mimeType: string;
        error?: string;
      }> = [];

      for (const [, val] of formData.entries()) {
        if (val && typeof val === 'object' && 'arrayBuffer' in val && typeof (val as File).size === 'number' && (val as File).size > 0) {
          const f = val as File;
          const mime = f.type || 'application/octet-stream';
          const lowerName = (f.name || '').toLowerCase();
          let itemType: 'image' | 'video' | 'file' = 'file';
          if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$/.test(lowerName)) {
            itemType = 'image';
          } else if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/.test(lowerName)) {
            itemType = 'video';
          }

          if (f.size > MAX_SHARED_BYTES) {
            items.push({
              type: itemType,
              dataUrl: '',
              filename: f.name || 'shared_file',
              size: f.size,
              mimeType: mime,
              error: `${itemType === 'video' ? 'Video' : 'File'} exceeds the 55MB sharing limit.`
            });
            continue;
          }

          const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const tmpPath = path.join(os.tmpdir(), `connexa_${tempId}`);

          if (typeof f.stream === 'function') {
            const writeStream = fs.createWriteStream(tmpPath);
            const reader = f.stream().getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.byteLength > 0) {
                  if (!writeStream.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
                    await new Promise<void>((r) => writeStream.once('drain', r));
                  }
                }
              }
              await new Promise<void>((resolve, reject) => {
                writeStream.end(() => resolve());
                writeStream.once('error', reject);
              });
            } finally {
              try {
                reader.releaseLock();
              } catch {
                // ignore
              }
            }
          } else {
            const buf = Buffer.from(await f.arrayBuffer());
            await fs.promises.writeFile(tmpPath, buf);
          }

          tempSharedFiles.set(tempId, {
            filePath: tmpPath,
            mimeType: mime,
            filename: f.name || 'shared_file',
            size: f.size,
            expiresAt: Date.now() + 5 * 60 * 1000
          });

          items.push({
            type: itemType,
            dataUrl: '',
            tempFileUrl: `/api/shared-temp/${tempId}`,
            filename: f.name || 'shared_file',
            size: f.size,
            mimeType: mime
          });
        }
      }

      if (items.length > 0) {
        const shareId = `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const onlyDocs = items.every(i => i.type === 'file');
        const recordJson = JSON.stringify({
          id: shareId,
          timestamp: Date.now(),
          type: onlyDocs ? 'file' : 'media',
          title,
          text,
          url,
          items
        }).replace(/</g, '\\u003c');

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Connexa Share</title></head><body style="background:#0f172a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Preparing shared content...<script>
(function(){
  var record = ${recordJson};
  function finish(){ window.location.replace('/?share_intent=universal&shared_id=' + encodeURIComponent(record.id)); }
  try {
    var req = indexedDB.open('connexa_share_target_db', 2);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) db.createObjectStore('shares', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('share_chunks')) {
        var cs = db.createObjectStore('share_chunks', { keyPath: 'key' });
        cs.createIndex('by_share', 'shareId', { unique: false });
      }
    };
    req.onsuccess = function(e){
      try {
        var db = e.target.result;
        var tx = db.transaction('shares', 'readwrite');
        tx.objectStore('shares').put(record);
        tx.oncomplete = finish;
        tx.onerror = finish;
      } catch (_) { finish(); }
    };
    req.onerror = finish;
  } catch (_) {
    try { localStorage.setItem('connexa_pending_universal_share', JSON.stringify(record)); } catch (__){}
    finish();
  }
})();
</script></body></html>`);
      }

      const sp = new URLSearchParams();
      sp.set('share_intent', 'universal');
      if (url) sp.set('shared_url', url);
      if (text) sp.set('shared_text', text);
      if (title) sp.set('shared_title', title);
      return res.redirect(303, `/?${sp.toString()}`);
    }

    const url = (req.body?.url || req.query?.url || '').toString();
    const text = (req.body?.text || req.query?.text || '').toString();
    const title = (req.body?.title || req.query?.title || '').toString();

    const sp = new URLSearchParams();
    if (url || text || title) sp.set('share_intent', 'universal');
    if (url) sp.set('shared_url', url);
    if (text) sp.set('shared_text', text);
    if (title) sp.set('shared_title', title);

    const queryStr = sp.toString();
    return res.redirect(303, queryStr ? `/?${queryStr}` : '/');
  } catch (err) {
    console.warn('Fallback /share-target POST error:', err);
    return res.redirect(303, '/');
  }
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

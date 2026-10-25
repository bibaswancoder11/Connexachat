// Connexa Messenger Service Worker v2 — Web Push, Background Notifications & Universal Web Share Target

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle Notification Clicks (focus open tab or open new window)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const clickData = event.notification.data || {};
  const chatId = clickData.chatId;
  const targetUrl = chatId ? `/?chatId=${encodeURIComponent(chatId)}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', payload: clickData });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle push events when app or browser tab is closed/in background
self.addEventListener('push', (event) => {
  let data = {
    title: 'Connexa Messenger',
    body: 'You have a new incoming message!',
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    data: {}
  };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'New message received',
    icon: data.icon || '/logo-192.png',
    badge: data.badge || data.icon || '/logo-192.png',
    tag: data.tag || (data.data?.chatId ? `connexa-chat-${data.data.chatId}` : 'connexa-msg'),
    data: data.data || {},
    vibrate: [200, 100, 200, 100, 200],
    renotify: true,
    actions: [
      { action: 'open', title: 'Open Chat' }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Connexa Messenger', options));
});

// IndexedDB helper for Web Share Target persistence
function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('connexa_share_target_db', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(request.error);
  });
}

async function storeShareRecord(record) {
  try {
    const db = await openShareDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('shares', 'readwrite');
      const store = tx.objectStore('shares');
      const req = store.put(record);
      req.onsuccess = () => resolve(record.id);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to store share record in IndexedDB:', err);
    return null;
  }
}

function isVisualMediaFile(file) {
  const mime = (file?.type || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
  const name = (file?.name || '').toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|bmp|heic|svg|mp4|webm|mov|mkv|avi|m4v|3gp)$/.test(name);
}

// Intercept Web Share Target POST requests (Images, Videos, Documents, Links, Text)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;

  const url = new URL(event.request.url);
  const isShareRoute =
    url.pathname === '/share-target' ||
    url.pathname.endsWith('/share-target') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html');

  if (!isShareRoute) return;

  event.respondWith(
    (async () => {
      let redirectUrl = '/';
      try {
        const formData = await event.request.formData();

        // Collect all shared File objects from 'media' or any file field
        const collectedFiles = [];
        for (const [, value] of formData.entries()) {
          if (value && typeof value === 'object' && typeof value.size === 'number' && value.size > 0) {
            collectedFiles.push(value);
          }
        }

        const title = (formData.get('title') || '').toString().trim();
        const text = (formData.get('text') || '').toString().trim();
        const sharedUrl = (formData.get('url') || '').toString().trim();

        const shareId = 'share_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        const hasFiles = collectedFiles.length > 0;
        const allDocs = hasFiles && collectedFiles.every((f) => !isVisualMediaFile(f));

        // Store in IndexedDB so the client retrieves files/links reliably even when launched cold
        const shareRecord = {
          id: shareId,
          timestamp: Date.now(),
          type: hasFiles ? (allDocs ? 'file' : 'media') : (sharedUrl ? 'link' : 'text'),
          title,
          text,
          url: sharedUrl,
          files: collectedFiles
        };

        await storeShareRecord(shareRecord);

        // Broadcast immediately if Connexa already has an open client window
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          if (hasFiles) {
            client.postMessage({
              type: allDocs ? 'WEB_SHARE_TARGET_FILE' : 'WEB_SHARE_TARGET_MEDIA',
              shareId,
              files: collectedFiles,
              title,
              text
            });
          } else {
            client.postMessage({
              type: 'WEB_SHARE_TARGET_LINK',
              shareId,
              url: sharedUrl,
              title,
              text
            });
          }
        }

        const searchParams = new URLSearchParams();
        searchParams.set('share_intent', 'universal');
        searchParams.set('shared_id', shareId);
        if (!hasFiles) {
          if (sharedUrl) searchParams.set('shared_url', sharedUrl);
          if (text) searchParams.set('shared_text', text);
          if (title) searchParams.set('shared_title', title);
        }
        redirectUrl = `/?${searchParams.toString()}`;
      } catch (e) {
        console.warn('Share target processing error in SW:', e);
      }
      return Response.redirect(redirectUrl, 303);
    })()
  );
});

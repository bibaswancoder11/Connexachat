// Connexa Messenger Service Worker for Web Push & Background Notifications

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
  const targetUrl = chatId ? `./?chatId=${encodeURIComponent(chatId)}` : './';

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
    icon: 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
    badge: 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
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
    icon: data.icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
    badge: data.badge || data.icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
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

// Intercept Web Share Target POST requests
self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST') {
    const url = new URL(event.request.url);
    if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.includes('/share')) {
      event.respondWith(
        (async () => {
          let redirectUrl = './';
          try {
            const formData = await event.request.formData();
            const mediaFiles = formData.getAll('media');
            const title = (formData.get('title') || '').toString().trim();
            const text = (formData.get('text') || '').toString().trim();
            const sharedUrl = (formData.get('url') || '').toString().trim();

            const shareId = 'share_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            const hasMedia = mediaFiles && mediaFiles.length > 0 && mediaFiles.some(f => f && f.size > 0);

            // Store in IndexedDB so the client can retrieve files and data even when launched from closed state
            const shareRecord = {
              id: shareId,
              timestamp: Date.now(),
              type: hasMedia ? 'media' : 'link',
              title,
              text,
              url: sharedUrl,
              files: hasMedia ? mediaFiles : []
            };

            await storeShareRecord(shareRecord);

            // Broadcast to any open windows if available
            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of clientList) {
              if (hasMedia) {
                client.postMessage({
                  type: 'WEB_SHARE_TARGET_MEDIA',
                  shareId,
                  files: mediaFiles,
                  text: `${title} ${text}`.trim()
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

            if (hasMedia) {
              redirectUrl = `./?share_intent=media&shared_id=${encodeURIComponent(shareId)}`;
            } else {
              const searchParams = new URLSearchParams();
              searchParams.set('shared_id', shareId);
              if (sharedUrl) searchParams.set('shared_url', sharedUrl);
              if (text) searchParams.set('shared_text', text);
              if (title) searchParams.set('shared_title', title);
              redirectUrl = `./?${searchParams.toString()}`;
            }
          } catch (e) {
            console.warn('Share target processing error in SW:', e);
          }
          return Response.redirect(redirectUrl, 303);
        })()
      );
    }
  }
});

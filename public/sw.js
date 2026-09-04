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

// Intercept Web Share Target POST requests
self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST') {
    const url = new URL(event.request.url);
    if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
      event.respondWith(
        (async () => {
          try {
            const formData = await event.request.formData();
            const mediaFiles = formData.getAll('media');
            const title = formData.get('title') || '';
            const text = formData.get('text') || '';

            // Redirect to main page and notify active clients with the files
            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            if (clientList.length > 0) {
              clientList[0].postMessage({
                type: 'WEB_SHARE_TARGET_MEDIA',
                files: mediaFiles,
                text: `${title} ${text}`.trim()
              });
              clientList[0].focus();
            }
          } catch (e) {
            console.warn('Share target processing error in SW:', e);
          }
          return Response.redirect('./', 303);
        })()
      );
    }
  }
});

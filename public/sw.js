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
          let redirectUrl = './';
          try {
            const formData = await event.request.formData();
            const mediaFiles = formData.getAll('media');
            const title = (formData.get('title') || '').toString();
            const text = (formData.get('text') || '').toString();
            const sharedUrl = (formData.get('url') || '').toString();

            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

            // If files were shared (photo/video)
            if (mediaFiles && mediaFiles.length > 0 && mediaFiles[0]?.size > 0) {
              if (clientList.length > 0) {
                clientList[0].postMessage({
                  type: 'WEB_SHARE_TARGET_MEDIA',
                  files: mediaFiles,
                  text: `${title} ${text}`.trim()
                });
                clientList[0].focus();
              }
              redirectUrl = './?share_intent=media';
            } 
            // If a link or text was shared
            else if (sharedUrl || text) {
              if (clientList.length > 0) {
                clientList[0].postMessage({
                  type: 'WEB_SHARE_TARGET_LINK',
                  url: sharedUrl,
                  title,
                  text
                });
                clientList[0].focus();
              }
              const searchParams = new URLSearchParams();
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

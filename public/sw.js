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
  const targetUrl = clickData.url || self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (clickData.action) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', payload: clickData });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle push events if browser push messaging is triggered
self.addEventListener('push', (event) => {
  let data = { title: 'New Notification on Connexa', body: 'You have a new message!' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
    badge: data.badge || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
    tag: data.tag || 'connexa-msg',
    data: data.data || {},
    vibrate: [200, 100, 200],
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

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

// IndexedDB v2 helper for Web Share Target persistence (supports 55MB videos via chunked ArrayBuffers)
const CHUNK_RAW_BYTES = 540672;
const MAX_SHARED_BYTES = 55 * 1024 * 1024;

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('connexa_share_target_db', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('share_chunks')) {
        const chunkStore = db.createObjectStore('share_chunks', { keyPath: 'key' });
        chunkStore.createIndex('by_share', 'shareId', { unique: false });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSharedFileIntoChunks(file) {
  if (typeof file.stream === 'function') {
    try {
      const reader = file.stream().getReader();
      const chunks = [];
      let currentBuf = new Uint8Array(CHUNK_RAW_BYTES);
      let currentOffset = 0;
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        let srcOffset = 0;
        while (srcOffset < value.byteLength) {
          const spaceLeft = CHUNK_RAW_BYTES - currentOffset;
          const toCopy = Math.min(spaceLeft, value.byteLength - srcOffset);
          currentBuf.set(value.subarray(srcOffset, srcOffset + toCopy), currentOffset);
          currentOffset += toCopy;
          srcOffset += toCopy;
          totalBytes += toCopy;

          if (currentOffset === CHUNK_RAW_BYTES) {
            chunks.push(currentBuf.buffer);
            currentBuf = new Uint8Array(CHUNK_RAW_BYTES);
            currentOffset = 0;
          }
        }
      }

      if (currentOffset > 0) {
        chunks.push(currentBuf.slice(0, currentOffset).buffer);
      }

      if (totalBytes > 0 && chunks.length > 0) {
        return { chunks, size: totalBytes };
      }
    } catch (err) {
      console.warn('SW stream read fallback:', err);
    }
  }

  // Fallback: sequential slice.arrayBuffer()
  const chunks = [];
  let totalBytes = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK_RAW_BYTES) {
    const end = Math.min(offset + CHUNK_RAW_BYTES, file.size);
    const buf = await file.slice(offset, end).arrayBuffer();
    chunks.push(buf);
    totalBytes += buf.byteLength;
  }
  return { chunks, size: totalBytes };
}

async function storeChunkedShareRecord(shareId, record, chunkEntries) {
  try {
    const db = await openShareDb();
    // Write chunks in small transactions so IndexedDB never hits memory caps on 50MB+ videos
    const BATCH_SIZE = 12;
    for (let i = 0; i < chunkEntries.length; i += BATCH_SIZE) {
      const batch = chunkEntries.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = db.transaction('share_chunks', 'readwrite');
        const store = tx.objectStore('share_chunks');
        for (const entry of batch) {
          store.put(entry);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IDB chunk write aborted'));
      });
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction('shares', 'readwrite');
      tx.objectStore('shares').put(record);
      tx.oncomplete = () => resolve(shareId);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB share record write aborted'));
    });

    return shareId;
  } catch (err) {
    console.warn('Failed to store chunked share record in IndexedDB:', err);
    return null;
  }
}

function classifySharedFile(file) {
  const mime = (file?.type || '').toLowerCase();
  const name = (file?.name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$/.test(name)) {
    return 'image';
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/.test(name)) {
    return 'video';
  }
  return 'file';
}

// Intercept Web Share Target POST requests (Images, Videos up to 55MB, Documents, Links, Text)
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

        // Read all shared files IMMEDIATELY into 528KB ArrayBuffers while the POST multipart stream is open!
        const chunkedFiles = [];
        const chunkEntries = [];

        for (let fIdx = 0; fIdx < collectedFiles.length; fIdx++) {
          const f = collectedFiles[fIdx];
          const category = classifySharedFile(f);
          const filename = f.name || (category === 'video' ? 'shared_video.mp4' : 'shared_file');
          const mimeType = f.type || (category === 'video' ? 'video/mp4' : 'application/octet-stream');

          if (f.size > MAX_SHARED_BYTES) {
            chunkedFiles.push({
              fileIndex: fIdx,
              category,
              filename,
              mimeType,
              size: f.size,
              chunkCount: 0,
              error: `${category === 'video' ? 'Video' : 'File'} "${filename}" is ${(f.size / (1024 * 1024)).toFixed(1)}MB. Maximum supported size is 55MB.`
            });
            continue;
          }

          try {
            const { chunks, size } = await readSharedFileIntoChunks(f);
            for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
              chunkEntries.push({
                key: `${shareId}_${fIdx}_${cIdx}`,
                shareId,
                fileIndex: fIdx,
                chunkIndex: cIdx,
                data: chunks[cIdx]
              });
            }
            chunkedFiles.push({
              fileIndex: fIdx,
              category,
              filename,
              mimeType,
              size,
              chunkCount: chunks.length
            });
          } catch (readErr) {
            console.warn('SW could not read shared file:', filename, readErr);
            chunkedFiles.push({
              fileIndex: fIdx,
              category,
              filename,
              mimeType,
              size: f.size,
              chunkCount: 0,
              error: `Could not read "${filename}". Please try sharing it again.`
            });
          }
        }

        const allDocs = hasFiles && chunkedFiles.length > 0 && chunkedFiles.every((cf) => cf.category === 'file');

        const shareRecord = {
          id: shareId,
          timestamp: Date.now(),
          type: hasFiles ? (allDocs ? 'file' : 'media') : (sharedUrl ? 'link' : 'text'),
          title,
          text,
          url: sharedUrl,
          chunkedFiles
        };

        await storeChunkedShareRecord(shareId, shareRecord, chunkEntries);

        // Notify any already-open Connexa client window via lightweight shareId signal (avoids cloning 50MB File over postMessage)
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          if (hasFiles) {
            client.postMessage({
              type: allDocs ? 'WEB_SHARE_TARGET_FILE' : 'WEB_SHARE_TARGET_MEDIA',
              shareId,
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

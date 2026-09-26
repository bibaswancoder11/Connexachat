/**
 * APK & Web Share Target Intent Handler for Connexa
 * Handles incoming shared media (photos, videos, text) from Android native share sheet,
 * Web Share Target API, or file drag-and-drop.
 */

import { SharedMediaItem } from '../components/ShareMediaModal';
import { compressImage } from './imageUtils';
import { processVideoFile } from './mediaUtils';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

export interface PendingSharePayload {
  items: SharedMediaItem[];
  text?: string;
  source?: 'android-share-sheet' | 'web-share-target' | 'file-drop';
}

export interface SharedLinkPayload {
  url: string;
  title?: string;
  text?: string;
  source?: 'android-share-sheet' | 'web-share-target' | 'query-param' | 'in-app';
}

type ShareIntentListener = (payload: PendingSharePayload) => void;
const listeners: Set<ShareIntentListener> = new Set();
let pendingPayload: PendingSharePayload | null = null;

export function subscribeToShareIntents(listener: ShareIntentListener): () => void {
  listeners.add(listener);
  if (pendingPayload) {
    listener(pendingPayload);
    pendingPayload = null;
  }
  return () => {
    listeners.delete(listener);
  };
}

export function notifyShareIntent(payload: PendingSharePayload) {
  if (listeners.size === 0) {
    pendingPayload = payload;
  } else {
    listeners.forEach(l => l(payload));
  }
}

type LinkShareIntentListener = (payload: SharedLinkPayload) => void;
const linkListeners: Set<LinkShareIntentListener> = new Set();
let pendingLinkPayload: SharedLinkPayload | null = null;

export function subscribeToLinkShareIntents(listener: LinkShareIntentListener): () => void {
  linkListeners.add(listener);
  if (pendingLinkPayload) {
    listener(pendingLinkPayload);
    pendingLinkPayload = null;
  }
  return () => {
    linkListeners.delete(listener);
  };
}

export function notifyLinkShareIntent(payload: SharedLinkPayload) {
  if (linkListeners.size === 0) {
    pendingLinkPayload = payload;
  } else {
    linkListeners.forEach(l => l(payload));
  }
}

/**
 * Extract URL and optional surrounding message caption from text
 */
export function extractUrlAndCaption(rawText: string): { url: string; caption: string } | null {
  if (!rawText) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/i;
  const match = rawText.match(urlRegex);
  if (!match) return null;

  const url = match[0];
  const caption = rawText.replace(url, '').trim();
  return { url, caption };
}

/**
 * Handle incoming files (from Android WebView file intent, drag-drop, or input)
 */
export async function processIncomingFilesForSharing(files: FileList | File[]): Promise<SharedMediaItem[]> {
  const items: SharedMediaItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
        items.push({
          type: 'image',
          dataUrl: compressed,
          filename: file.name
        });
      } else if (file.type.startsWith('video/')) {
        const meta = await processVideoFile(file);
        items.push({
          type: 'video',
          dataUrl: meta.dataUrl,
          thumbnailUrl: meta.thumbnailUrl,
          duration: meta.duration,
          filename: file.name
        });
      }
    } catch (err) {
      console.warn('Could not process shared file:', file.name, err);
    }
  }

  return items;
}

/**
 * Open IndexedDB shared store
 */
function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('connexa_share_target_db', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e: any) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve and clear a pending share from IndexedDB
 */
export async function fetchAndClearSharedRecord(shareId?: string): Promise<{
  id: string;
  type: 'media' | 'link';
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
} | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;

  try {
    const db = await openShareDb();
    return new Promise((resolve) => {
      const tx = db.transaction('shares', 'readwrite');
      const store = tx.objectStore('shares');

      if (shareId) {
        const getReq = store.get(shareId);
        getReq.onsuccess = () => {
          const result = getReq.result;
          if (result) {
            store.delete(shareId);
            resolve(result);
          } else {
            resolve(null);
          }
        };
        getReq.onerror = () => resolve(null);
      } else {
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const records = getAllReq.result || [];
          if (records.length === 0) {
            resolve(null);
            return;
          }
          records.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
          const newest = records[0];
          const isFresh = Date.now() - (newest.timestamp || 0) < 180000; // 3 minutes
          if (isFresh) {
            store.delete(newest.id);
            resolve(newest);
          } else {
            resolve(null);
          }
        };
        getAllReq.onerror = () => resolve(null);
      }
    });
  } catch (err) {
    console.warn('Could not read from share target IndexedDB:', err);
    return null;
  }
}

let isInitialized = false;

/**
 * Process any pending share from IndexedDB or URL parameters
 */
export async function checkPendingShareTargets() {
  if (typeof window === 'undefined') return;

  try {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shared_id');
    const shareIntent = params.get('share_intent');

    // 1. Check IndexedDB if shared_id or share_intent=media exists
    if (sharedId || shareIntent === 'media') {
      const record = await fetchAndClearSharedRecord(sharedId || undefined);
      if (record) {
        if (record.type === 'media' && record.files && record.files.length > 0) {
          const items = await processIncomingFilesForSharing(record.files);
          if (items.length > 0 || record.text) {
            notifyShareIntent({
              items,
              text: record.text,
              source: 'web-share-target'
            });
          }
        } else if (record.url || record.text) {
          let url = record.url || '';
          let text = record.text || '';
          if (!url && text) {
            const extracted = extractUrlAndCaption(text);
            if (extracted) {
              url = extracted.url;
              text = extracted.caption;
            }
          }
          if (url) {
            notifyLinkShareIntent({
              url,
              title: record.title,
              text,
              source: 'web-share-target'
            });
          }
        }
      }
    }

    // 2. Check URL query parameters (links/text directly passed via GET or SW redirect)
    const sharedUrl = params.get('shared_url') || params.get('url') || params.get('link');
    const sharedText = params.get('shared_text') || params.get('text');
    const sharedTitle = params.get('shared_title') || params.get('title');

    if (sharedUrl || sharedText) {
      let finalUrl = sharedUrl || '';
      let finalText = sharedText || '';

      if (!finalUrl && sharedText) {
        const extracted = extractUrlAndCaption(sharedText);
        if (extracted) {
          finalUrl = extracted.url;
          finalText = extracted.caption;
        }
      }

      if (finalUrl) {
        notifyLinkShareIntent({
          url: finalUrl,
          title: sharedTitle || undefined,
          text: finalText || undefined,
          source: 'query-param'
        });
      }
    }

    // Clean URL parameters to prevent re-opening on manual page refresh
    if (sharedId || shareIntent || sharedUrl || sharedText || sharedTitle) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('shared_id');
      cleanUrl.searchParams.delete('share_intent');
      cleanUrl.searchParams.delete('shared_url');
      cleanUrl.searchParams.delete('url');
      cleanUrl.searchParams.delete('link');
      cleanUrl.searchParams.delete('shared_text');
      cleanUrl.searchParams.delete('text');
      cleanUrl.searchParams.delete('shared_title');
      cleanUrl.searchParams.delete('title');
      const searchStr = cleanUrl.searchParams.toString();
      window.history.replaceState({}, '', cleanUrl.pathname + (searchStr ? '?' + searchStr : ''));
    }
  } catch (err) {
    console.warn('Error checking pending share targets:', err);
  }
}

/**
 * Initialize listeners for Web Share Target (ServiceWorker postMessage, IndexedDB, or URL query params)
 */
export function initShareTargetListener() {
  if (typeof window === 'undefined') return;
  if (isInitialized) {
    checkPendingShareTargets();
    return;
  }
  isInitialized = true;

  // 1. Initial check on load
  checkPendingShareTargets();

  // 2. Re-check when window gains focus or becomes visible
  window.addEventListener('focus', () => {
    checkPendingShareTargets();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkPendingShareTargets();
    }
  });

  // 3. Listen for Service Worker postMessage
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data?.type === 'WEB_SHARE_TARGET_MEDIA') {
        const { files, text, shareId } = event.data;
        if (files && files.length > 0) {
          const items = await processIncomingFilesForSharing(files);
          if (items.length > 0 || text) {
            notifyShareIntent({
              items,
              text,
              source: 'web-share-target'
            });
          }
        } else if (shareId) {
          checkPendingShareTargets();
        }
      } else if (event.data?.type === 'WEB_SHARE_TARGET_LINK') {
        let { url, text, title, shareId } = event.data;
        if (!url && text) {
          const extracted = extractUrlAndCaption(text);
          if (extracted) {
            url = extracted.url;
            text = extracted.caption;
          }
        }
        if (url) {
          notifyLinkShareIntent({
            url,
            title,
            text,
            source: 'web-share-target'
          });
        } else if (shareId) {
          checkPendingShareTargets();
        }
      }
    });
  }

  // 4. Listen for Native Android Capacitor App URL Open events
  if (Capacitor.isNativePlatform()) {
    try {
      CapApp.addListener('appUrlOpen', async (data) => {
        if (!data?.url) return;
        try {
          const parsed = new URL(data.url);
          const sharedUrl = parsed.searchParams.get('shared_url') || parsed.searchParams.get('url') || parsed.searchParams.get('link');
          const sharedText = parsed.searchParams.get('shared_text') || parsed.searchParams.get('text');
          const sharedTitle = parsed.searchParams.get('shared_title') || parsed.searchParams.get('title');

          if (sharedUrl || sharedText) {
            let finalUrl = sharedUrl || '';
            let finalText = sharedText || '';

            if (!finalUrl && sharedText) {
              const extracted = extractUrlAndCaption(sharedText);
              if (extracted) {
                finalUrl = extracted.url;
                finalText = extracted.caption;
              }
            }

            if (finalUrl) {
              notifyLinkShareIntent({
                url: finalUrl,
                title: sharedTitle || undefined,
                text: finalText || undefined,
                source: 'android-share-sheet'
              });
            }
          }
        } catch (e) {
          console.warn('Error parsing appUrlOpen data:', e);
        }
      });
    } catch (e) {
      console.warn('Capacitor App listener error:', e);
    }
  }

  // 5. Custom DOM events for testing or programmatic triggering
  window.addEventListener('connexa:share-media', async (e: any) => {
    if (e.detail?.files) {
      const items = await processIncomingFilesForSharing(e.detail.files);
      if (items.length > 0 || e.detail.text) {
        notifyShareIntent({
          items,
          text: e.detail.text,
          source: 'android-share-sheet'
        });
      }
    }
  });

  window.addEventListener('connexa:share-link', (e: any) => {
    if (e.detail?.url) {
      notifyLinkShareIntent({
        url: e.detail.url,
        title: e.detail.title,
        text: e.detail.text,
        source: 'android-share-sheet'
      });
    }
  });
}

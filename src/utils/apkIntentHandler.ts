/**
 * APK & Web Share Target Intent Handler for Connexa
 * Handles incoming shared items (links, documents, photos, videos, text) from Android native share sheet,
 * Web Share Target API, or file drag-and-drop.
 */

import { SharedMediaItem } from '../components/ShareMediaModal';
import { UniversalSharePayload, UniversalShareItem } from '../components/UniversalShareModal';
export type { UniversalSharePayload, UniversalShareItem };
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

// 1. Universal Share Listener (WhatsApp-Style Unified Share Target)
type UniversalShareListener = (payload: UniversalSharePayload) => void;
const universalListeners: Set<UniversalShareListener> = new Set();
let pendingUniversalPayload: UniversalSharePayload | null = null;

export function subscribeToUniversalShareIntents(listener: UniversalShareListener): () => void {
  universalListeners.add(listener);
  if (pendingUniversalPayload) {
    listener(pendingUniversalPayload);
    pendingUniversalPayload = null;
  }
  return () => {
    universalListeners.delete(listener);
  };
}

export function notifyUniversalShareIntent(payload: UniversalSharePayload) {
  if (universalListeners.size === 0) {
    pendingUniversalPayload = payload;
  } else {
    universalListeners.forEach(l => l(payload));
  }

  // Also bridge to legacy listeners for backward compatibility
  if (payload.type === 'link' && payload.url) {
    legacyNotifyLinkShare({
      url: payload.url,
      title: payload.title,
      text: payload.caption || payload.text,
      source: (payload.source as any) || 'android-share-sheet'
    });
  } else if ((payload.type === 'media' || payload.type === 'file') && payload.items) {
    legacyNotifyMediaShare({
      items: payload.items as any,
      text: payload.caption || payload.text,
      source: (payload.source as any) || 'android-share-sheet'
    });
  }
}

// 2. Legacy Media Listeners
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

function legacyNotifyMediaShare(payload: PendingSharePayload) {
  if (listeners.size === 0) {
    pendingPayload = payload;
  } else {
    listeners.forEach(l => l(payload));
  }
}

export function notifyShareIntent(payload: PendingSharePayload) {
  legacyNotifyMediaShare(payload);
  const isVideo = payload.items.some(i => i.type === 'video');
  notifyUniversalShareIntent({
    type: isVideo || payload.items.length > 0 ? 'media' : 'text',
    items: payload.items as any,
    caption: payload.text,
    text: payload.text,
    source: payload.source
  });
}

// 3. Legacy Link Listeners
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

function legacyNotifyLinkShare(payload: SharedLinkPayload) {
  if (linkListeners.size === 0) {
    pendingLinkPayload = payload;
  } else {
    linkListeners.forEach(l => l(payload));
  }
}

export function notifyLinkShareIntent(payload: SharedLinkPayload) {
  legacyNotifyLinkShare(payload);
  notifyUniversalShareIntent({
    type: 'link',
    url: payload.url,
    title: payload.title,
    caption: payload.text,
    text: payload.text,
    source: payload.source
  });
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
 * Handle incoming files (photos, videos, documents/PDFs, audio)
 */
export async function processIncomingFilesForSharing(files: FileList | File[]): Promise<UniversalShareItem[]> {
  const items: UniversalShareItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
        items.push({
          type: 'image',
          dataUrl: compressed,
          filename: file.name,
          size: file.size,
          mimeType: file.type
        });
      } else if (file.type.startsWith('video/')) {
        const meta = await processVideoFile(file);
        items.push({
          type: 'video',
          dataUrl: meta.dataUrl,
          thumbnailUrl: meta.thumbnailUrl,
          duration: meta.duration,
          filename: file.name,
          size: file.size,
          mimeType: file.type
        });
      } else {
        // Document / PDF / Audio / Archive / Any file
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        items.push({
          type: 'file',
          dataUrl,
          filename: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
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
  type: 'media' | 'link' | 'file';
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
 * Process any pending share from Android intent, IndexedDB, or URL parameters
 */
export async function checkPendingShareTargets() {
  if (typeof window === 'undefined') return;

  try {
    // 0. Check localStorage for universal share payload
    const rawUniversal = localStorage.getItem('connexa_pending_universal_share');
    if (rawUniversal) {
      localStorage.removeItem('connexa_pending_universal_share');
      try {
        const parsed = JSON.parse(rawUniversal);
        if (parsed) {
          notifyUniversalShareIntent(parsed);
          return;
        }
      } catch (e) {
        console.warn('Error parsing connexa_pending_universal_share:', e);
      }
    }

    // Check localStorage for link
    const rawStored = localStorage.getItem('connexa_pending_share_link');
    if (rawStored) {
      localStorage.removeItem('connexa_pending_share_link');
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawStored);
      } catch {
        parsed = { text: rawStored };
      }
      let url = parsed.url || '';
      let text = parsed.text || '';
      let title = parsed.title || '';
      if (!url && text) {
        const extracted = extractUrlAndCaption(text);
        if (extracted) {
          url = extracted.url;
          text = extracted.caption;
        }
      }
      if (url) {
        notifyUniversalShareIntent({
          type: 'link',
          url,
          title: title || undefined,
          caption: text || undefined,
          text: text || undefined,
          source: 'android-share-sheet'
        });
        return;
      }
    }

    // Check localStorage for media
    const rawMediaStored = localStorage.getItem('connexa_pending_share_media');
    if (rawMediaStored) {
      localStorage.removeItem('connexa_pending_share_media');
      let parsedMedia: any = null;
      try {
        parsedMedia = JSON.parse(rawMediaStored);
      } catch {
        parsedMedia = null;
      }
      if (parsedMedia && (Array.isArray(parsedMedia.items) || parsedMedia.text)) {
        notifyUniversalShareIntent({
          type: 'media',
          items: parsedMedia.items || [],
          caption: parsedMedia.text,
          text: parsedMedia.text,
          source: 'android-share-sheet'
        });
        return;
      }
    }

    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shared_id');
    const shareIntent = params.get('share_intent');

    // 1. Check IndexedDB if shared_id or share_intent exists
    if (sharedId || shareIntent === 'media' || shareIntent === 'universal') {
      const record = await fetchAndClearSharedRecord(sharedId || undefined);
      if (record) {
        if (record.files && record.files.length > 0) {
          const items = await processIncomingFilesForSharing(record.files);
          const hasImagesOrVideos = items.some(i => i.type === 'image' || i.type === 'video');
          const finalType = hasImagesOrVideos ? 'media' : (items.some(i => i.type === 'file') ? 'file' : 'media');

          if (items.length > 0 || record.text) {
            notifyUniversalShareIntent({
              type: finalType,
              items,
              caption: record.text,
              text: record.text,
              source: 'web-share-target'
            });
            return;
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
            notifyUniversalShareIntent({
              type: 'link',
              url,
              title: record.title,
              caption: text,
              text,
              source: 'web-share-target'
            });
            return;
          } else if (text) {
            notifyUniversalShareIntent({
              type: 'text',
              caption: text,
              text,
              source: 'web-share-target'
            });
            return;
          }
        }
      }
    }

    // 2. Check URL query parameters
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
        notifyUniversalShareIntent({
          type: 'link',
          url: finalUrl,
          title: sharedTitle || undefined,
          caption: finalText || undefined,
          text: finalText || undefined,
          source: 'query-param'
        });
      } else if (finalText) {
        notifyUniversalShareIntent({
          type: 'text',
          caption: finalText,
          text: finalText,
          source: 'query-param'
        });
      }
    }

    // Clean URL parameters
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
 * Initialize listeners for Web Share Target & Android intents
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
      if (event.data?.type === 'WEB_SHARE_TARGET_MEDIA' || event.data?.type === 'WEB_SHARE_TARGET_FILE') {
        const { files, text, shareId } = event.data;
        if (files && files.length > 0) {
          const items = await processIncomingFilesForSharing(files);
          const hasImagesOrVideos = items.some(i => i.type === 'image' || i.type === 'video');
          notifyUniversalShareIntent({
            type: hasImagesOrVideos ? 'media' : 'file',
            items,
            caption: text,
            text,
            source: 'web-share-target'
          });
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
          notifyUniversalShareIntent({
            type: 'link',
            url,
            title,
            caption: text,
            text,
            source: 'web-share-target'
          });
        } else if (shareId) {
          checkPendingShareTargets();
        }
      }
    });
  }

  // 4. Native Android Capacitor App URL Open events
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
              notifyUniversalShareIntent({
                type: 'link',
                url: finalUrl,
                title: sharedTitle || undefined,
                caption: finalText || undefined,
                text: finalText || undefined,
                source: 'android-share-sheet'
              });
            } else if (finalText) {
              notifyUniversalShareIntent({
                type: 'text',
                caption: finalText,
                text: finalText,
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

  // 5. Custom DOM events for testing or programmatic triggering from Android WebView
  window.addEventListener('connexa:universal-share', (e: any) => {
    if (e.detail) {
      notifyUniversalShareIntent(e.detail);
    }
  });

  window.addEventListener('connexa:share-media', async (e: any) => {
    if (e.detail?.files) {
      const items = await processIncomingFilesForSharing(e.detail.files);
      if (items.length > 0 || e.detail.text) {
        notifyUniversalShareIntent({
          type: 'media',
          items,
          caption: e.detail.text,
          text: e.detail.text,
          source: 'android-share-sheet'
        });
      }
    }
  });

  window.addEventListener('connexa:share-link', (e: any) => {
    let url = e.detail?.url || '';
    let text = e.detail?.text || '';
    let title = e.detail?.title || '';
    if (!url && text) {
      const extracted = extractUrlAndCaption(text);
      if (extracted) {
        url = extracted.url;
        text = extracted.caption;
      }
    }
    if (url) {
      notifyUniversalShareIntent({
        type: 'link',
        url,
        title: title || undefined,
        caption: text || undefined,
        text: text || undefined,
        source: 'android-share-sheet'
      });
    } else if (text) {
      notifyUniversalShareIntent({
        type: 'text',
        caption: text,
        text,
        source: 'android-share-sheet'
      });
    }
  });
}

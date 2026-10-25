/**
 * APK & Web Share Target Intent Handler for Connexa
 * Handles incoming shared items (links, documents, photos, videos, audio, text)
 * from Android native share sheet (IntentResolver), Web Share Target API (PWA), or in-app triggers,
 * routing every shared item to the unified WhatsApp-style UniversalShareModal.
 */

import { SharedMediaItem } from '../components/ShareMediaModal';
import { UniversalSharePayload, UniversalShareItem } from '../components/UniversalShareModal';
export type { UniversalSharePayload, UniversalShareItem };
import { compressImage } from './imageUtils';
import { processVideoFile, MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_MB } from './mediaUtils';
import { base64ToUint8Array, CHUNK_RAW_BYTES } from '../services/mediaStorageService';
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

// Unified WhatsApp-Style Share Listener
type UniversalShareListener = (payload: UniversalSharePayload) => void;
const universalListeners: Set<UniversalShareListener> = new Set();
let pendingUniversalPayload: UniversalSharePayload | null = null;

export function subscribeToUniversalShareIntents(listener: UniversalShareListener): () => void {
  universalListeners.add(listener);
  if (pendingUniversalPayload) {
    const queued = pendingUniversalPayload;
    pendingUniversalPayload = null;
    listener(queued);
  }
  return () => {
    universalListeners.delete(listener);
  };
}

/**
 * Normalize any incoming share payload so:
 * - Links don't repeat the raw URL inside the optional caption
 * - Media (images/videos) vs Documents/Files are accurately typed
 */
function normalizeUniversalPayload(payload: UniversalSharePayload): UniversalSharePayload {
  const normalized: UniversalSharePayload = { ...payload };

  // If items exist, determine whether they are visual media (image/video) or documents/files
  if (normalized.items && normalized.items.length > 0) {
    const allVisualMedia = normalized.items.every(i => i.type === 'image' || i.type === 'video');
    normalized.type = allVisualMedia ? 'media' : (normalized.items.some(i => i.type === 'file') && !normalized.items.some(i => i.type === 'image' || i.type === 'video') ? 'file' : normalized.type === 'file' ? 'file' : 'media');

    // Clean caption if it only echoes nothing
    if (normalized.caption === undefined && normalized.text) {
      normalized.caption = normalized.text;
    }
    return normalized;
  }

  // If text contains a URL and url wasn't separated yet, extract it cleanly
  const rawText = normalized.text || normalized.caption || '';
  if (!normalized.url && rawText) {
    const extracted = extractUrlAndCaption(rawText);
    if (extracted) {
      normalized.type = 'link';
      normalized.url = extracted.url;
      normalized.caption = extracted.caption;
      normalized.text = extracted.caption;
      return normalized;
    }
  }

  // If it's a link, strip the URL out of caption so the optional caption box starts clean
  if (normalized.type === 'link' && normalized.url) {
    const cleanCap = (normalized.caption ?? normalized.text ?? '')
      .replace(normalized.url, '')
      .trim();
    normalized.caption = cleanCap;
    normalized.text = cleanCap;
  }

  return normalized;
}

export function notifyUniversalShareIntent(rawPayload: UniversalSharePayload) {
  const payload = normalizeUniversalPayload(rawPayload);
  if (universalListeners.size === 0) {
    pendingUniversalPayload = payload;
  } else {
    universalListeners.forEach(l => l(payload));
  }
}

// Legacy adapters — route straight into UniversalShareModal (never open duplicate modals)
export function subscribeToShareIntents(_listener: (payload: PendingSharePayload) => void): () => void {
  return () => {};
}

export function notifyShareIntent(payload: PendingSharePayload) {
  const items: UniversalShareItem[] = (payload.items || []).map(item => ({
    type: item.type,
    dataUrl: item.dataUrl,
    file: item.file,
    mimeType: item.mimeType,
    thumbnailUrl: item.thumbnailUrl,
    duration: item.duration,
    filename: item.filename,
    size: item.size
  }));
  notifyUniversalShareIntent({
    type: items.length > 0 ? 'media' : 'text',
    items,
    caption: payload.text,
    text: payload.text,
    source: payload.source
  });
}

export function subscribeToLinkShareIntents(_listener: (payload: SharedLinkPayload) => void): () => void {
  return () => {};
}

export function notifyLinkShareIntent(payload: SharedLinkPayload) {
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
 * Infer whether a File is an image, video, or general document/file
 */
function classifyFileCategory(file: File): 'image' | 'video' | 'file' {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$/.test(name)) {
    return 'image';
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|3gp|m4v)$/.test(name)) {
    return 'video';
  }
  return 'file';
}

/**
 * Handle incoming files (photos, videos up to 55MB, PDFs, Office docs, archives, audio, any file)
 */
export async function processIncomingFilesForSharing(files: FileList | File[]): Promise<UniversalShareItem[]> {
  const items: UniversalShareItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || file.size === 0) continue;

    const category = classifyFileCategory(file);
    try {
      if (category === 'image') {
        try {
          const compressed = await compressImage(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.84 });
          items.push({
            type: 'image',
            dataUrl: compressed,
            filename: file.name,
            size: file.size,
            mimeType: file.type || 'image/jpeg'
          });
        } catch {
          const previewUrl = URL.createObjectURL(file);
          items.push({
            type: 'image',
            dataUrl: previewUrl,
            file,
            filename: file.name,
            size: file.size,
            mimeType: file.type || 'image/png'
          });
        }
      } else if (category === 'video') {
        if (file.size > MAX_VIDEO_SIZE_BYTES) {
          items.push({
            type: 'video',
            dataUrl: '',
            filename: file.name,
            size: file.size,
            mimeType: file.type || 'video/mp4',
            error: `Video file "${file.name || 'clip'}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Maximum supported video size is ${MAX_VIDEO_SIZE_MB}MB.`
          });
          continue;
        }
        try {
          const meta = await processVideoFile(file, MAX_VIDEO_SIZE_BYTES);
          items.push({
            type: 'video',
            dataUrl: meta.dataUrl,
            file: meta.file || file,
            thumbnailUrl: meta.thumbnailUrl,
            duration: meta.duration,
            filename: file.name,
            size: file.size,
            mimeType: meta.mimeType || file.type || 'video/mp4'
          });
        } catch {
          const blobUrl = URL.createObjectURL(file);
          items.push({
            type: 'video',
            dataUrl: blobUrl,
            file,
            filename: file.name,
            size: file.size,
            mimeType: file.type || 'video/mp4'
          });
        }
      } else {
        // Document / PDF / Audio / Archive / Any file (up to 55MB via streaming Blob)
        if (file.size > MAX_VIDEO_SIZE_BYTES) {
          items.push({
            type: 'file',
            dataUrl: '',
            filename: file.name || 'Document',
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            error: `File "${file.name || 'Document'}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Maximum supported file size is ${MAX_VIDEO_SIZE_MB}MB.`
          });
          continue;
        }
        const blobUrl = URL.createObjectURL(file);
        items.push({
          type: 'file',
          dataUrl: blobUrl,
          file,
          filename: file.name || 'Document',
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  type: 'media' | 'link' | 'file' | 'text';
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
  items?: UniversalShareItem[];
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
          const isFresh = Date.now() - (newest.timestamp || 0) < 300000; // 5 minutes
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

/**
 * Hydrate any native Android temp-file references (nativeFileId) or server temp-file URLs (tempFileUrl)
 * into real File/Blob objects with thumbnails so 55MB videos never cause Java/WebView OOM.
 */
async function hydrateExternalSharedItems(rawItems: any[], bridge?: any): Promise<UniversalShareItem[]> {
  const hydrated: UniversalShareItem[] = [];
  const filesToProcess: File[] = [];

  for (const raw of rawItems) {
    if (!raw) continue;

    if (raw.error) {
      hydrated.push({
        type: raw.type || 'video',
        dataUrl: '',
        filename: raw.filename,
        size: raw.size,
        mimeType: raw.mimeType,
        error: raw.error
      });
      continue;
    }

    // 1. Native Android chunked file bridge (supports 55MB+ videos with ~2MB RAM overhead)
    if (raw.nativeFileId && bridge && typeof bridge.getSharedFileChunkBase64 === 'function') {
      try {
        const totalSize = Number(raw.size || 0);
        const parts: BlobPart[] = [];
        let offset = 0;
        const step = CHUNK_RAW_BYTES;

        while (true) {
          const b64Chunk = bridge.getSharedFileChunkBase64(raw.nativeFileId, offset, step);
          if (!b64Chunk || typeof b64Chunk !== 'string' || b64Chunk.length === 0) {
            break;
          }
          const bytes = base64ToUint8Array(b64Chunk);
          if (bytes.byteLength === 0) break;
          parts.push(bytes);
          offset += bytes.byteLength;
          if (totalSize > 0 && offset >= totalSize) break;
        }

        if (typeof bridge.deleteSharedTempFile === 'function') {
          try {
            bridge.deleteSharedTempFile(raw.nativeFileId);
          } catch {
            // ignore
          }
        }

        if (parts.length > 0) {
          const reconstructed = new File(parts, raw.filename || 'shared_video.mp4', {
            type: raw.mimeType || 'application/octet-stream'
          });
          filesToProcess.push(reconstructed);
          continue;
        }
      } catch (err) {
        console.warn('Failed reading chunked native shared file:', err);
      }
    }

    // 2. Express fallback /api/shared-temp/:id binary stream
    if (raw.tempFileUrl && typeof raw.tempFileUrl === 'string') {
      try {
        const resp = await fetch(raw.tempFileUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const reconstructed = new File([blob], raw.filename || 'shared_file', {
            type: raw.mimeType || blob.type || 'application/octet-stream'
          });
          filesToProcess.push(reconstructed);
          continue;
        }
      } catch (err) {
        console.warn('Failed fetching temp shared file:', err);
      }
    }

    hydrated.push(raw as UniversalShareItem);
  }

  if (filesToProcess.length > 0) {
    const processed = await processIncomingFilesForSharing(filesToProcess);
    hydrated.push(...processed);
  }

  return hydrated;
}

/**
 * Check Native Android JavascriptInterface Bridge (MainActivity.java -> ConnexaAndroidShare)
 * Completely immune to cold-start WebView timing races, 5MB localStorage limits, and 55MB OOMs!
 */
export async function checkNativeAndroidShareBridge(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const bridge = (window as any).ConnexaAndroidShare;
    if (bridge && typeof bridge.hasPendingShare === 'function' && bridge.hasPendingShare()) {
      const rawJson = bridge.consumePendingShare();
      if (rawJson && typeof rawJson === 'string') {
        const parsed = JSON.parse(rawJson);
        if (parsed) {
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            parsed.items = await hydrateExternalSharedItems(parsed.items, bridge);
          }
          notifyUniversalShareIntent(parsed);
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('Error reading ConnexaAndroidShare native bridge:', err);
  }
  return false;
}

let isInitialized = false;
let isCheckingPending = false;

/**
 * Process any pending share from Native Android Bridge, localStorage, IndexedDB, or URL parameters
 */
export async function checkPendingShareTargets() {
  if (typeof window === 'undefined' || isCheckingPending) return;
  isCheckingPending = true;

  try {
    // 1. Check Native Android JavascriptInterface Bridge first (highest priority, supports 55MB videos/PDFs)
    if (await checkNativeAndroidShareBridge()) {
      return;
    }

    // 2. Check localStorage for universal share payload
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

    // Check legacy localStorage keys
    const rawStored = localStorage.getItem('connexa_pending_share_link');
    if (rawStored) {
      localStorage.removeItem('connexa_pending_share_link');
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawStored);
      } catch {
        parsed = { text: rawStored };
      }
      const url = parsed?.url || '';
      const text = parsed?.text || '';
      const title = parsed?.title || '';
      if (url || text) {
        notifyUniversalShareIntent({
          type: url ? 'link' : 'text',
          url: url || undefined,
          title: title || undefined,
          caption: text || undefined,
          text: text || undefined,
          source: 'android-share-sheet'
        });
        return;
      }
    }

    const rawMediaStored = localStorage.getItem('connexa_pending_share_media');
    if (rawMediaStored) {
      localStorage.removeItem('connexa_pending_share_media');
      try {
        const parsedMedia = JSON.parse(rawMediaStored);
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
      } catch {
        // ignore
      }
    }

    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shared_id');
    const shareIntent = params.get('share_intent');

    // 3. Always check IndexedDB for fresh shared records (covers both ?shared_id=... and cold PWA launches)
    const record = await fetchAndClearSharedRecord(sharedId || undefined);
    if (record) {
      cleanShareUrlParams();

      if (record.items && record.items.length > 0) {
        const hydratedItems = await hydrateExternalSharedItems(record.items);
        const hasDoc = hydratedItems.some(i => i.type === 'file') && !hydratedItems.some(i => i.type === 'image' || i.type === 'video');
        notifyUniversalShareIntent({
          type: hasDoc ? 'file' : 'media',
          items: hydratedItems,
          title: record.title,
          caption: record.text,
          text: record.text,
          source: 'web-share-target'
        });
        return;
      }

      if (record.files && record.files.length > 0) {
        const items = await processIncomingFilesForSharing(record.files);
        const onlyDocs = items.length > 0 && items.every(i => i.type === 'file');
        if (items.length > 0 || record.text) {
          notifyUniversalShareIntent({
            type: onlyDocs ? 'file' : 'media',
            items,
            title: record.title,
            caption: record.text,
            text: record.text,
            source: 'web-share-target'
          });
          return;
        }
      }

      if (record.url || record.text) {
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
            title: record.title,
            caption: text,
            text,
            source: 'web-share-target'
          });
          return;
        }
      }
    }

    // 4. Check URL query parameters (?shared_url=...&shared_text=...&shared_title=...)
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

      cleanShareUrlParams();

      if (finalUrl) {
        notifyUniversalShareIntent({
          type: 'link',
          url: finalUrl,
          title: sharedTitle || undefined,
          caption: finalText || undefined,
          text: finalText || undefined,
          source: 'query-param'
        });
        return;
      } else if (finalText) {
        notifyUniversalShareIntent({
          type: 'text',
          title: sharedTitle || undefined,
          caption: finalText,
          text: finalText,
          source: 'query-param'
        });
        return;
      }
    }

    if (sharedId || shareIntent) {
      cleanShareUrlParams();
    }
  } catch (err) {
    console.warn('Error checking pending share targets:', err);
  } finally {
    isCheckingPending = false;
  }
}

function cleanShareUrlParams() {
  try {
    const cleanUrl = new URL(window.location.href);
    const keysToRemove = [
      'shared_id',
      'share_intent',
      'shared_url',
      'url',
      'link',
      'shared_text',
      'text',
      'shared_title',
      'title'
    ];
    let changed = false;
    for (const k of keysToRemove) {
      if (cleanUrl.searchParams.has(k)) {
        cleanUrl.searchParams.delete(k);
        changed = true;
      }
    }
    if (changed) {
      const searchStr = cleanUrl.searchParams.toString();
      window.history.replaceState({}, '', cleanUrl.pathname + (searchStr ? '?' + searchStr : ''));
    }
  } catch {
    // ignore
  }
}

/**
 * Initialize listeners for Native Android Share Sheet & Web Share Target API
 */
export function initShareTargetListener() {
  if (typeof window === 'undefined') return;
  if (isInitialized) {
    checkPendingShareTargets();
    return;
  }
  isInitialized = true;

  // 1. Initial check on load + staggered checks for cold-start Android WebView bridge readiness
  checkPendingShareTargets();
  setTimeout(() => checkPendingShareTargets(), 350);
  setTimeout(() => checkPendingShareTargets(), 1100);

  // 2. Re-check when window gains focus or becomes visible
  window.addEventListener('focus', () => {
    checkPendingShareTargets();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkPendingShareTargets();
    }
  });

  // 3. Listen for Native Android Bridge Ready signal from MainActivity.java
  window.addEventListener('connexa:native-share-ready', () => {
    checkNativeAndroidShareBridge();
  });

  // 4. Listen for Service Worker postMessage (when PWA is already open and receives a share)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data?.type === 'WEB_SHARE_TARGET_MEDIA' || event.data?.type === 'WEB_SHARE_TARGET_FILE') {
        const { files, text, title, shareId } = event.data;
        // Clear IndexedDB copy so we don't process twice on next focus
        if (shareId) {
          fetchAndClearSharedRecord(shareId).catch(() => {});
        }
        if (files && files.length > 0) {
          const items = await processIncomingFilesForSharing(files);
          const onlyDocs = items.length > 0 && items.every(i => i.type === 'file');
          notifyUniversalShareIntent({
            type: onlyDocs ? 'file' : 'media',
            items,
            title,
            caption: text,
            text,
            source: 'web-share-target'
          });
        } else {
          checkPendingShareTargets();
        }
      } else if (event.data?.type === 'WEB_SHARE_TARGET_LINK') {
        let { url, text, title, shareId } = event.data;
        if (shareId) {
          fetchAndClearSharedRecord(shareId).catch(() => {});
        }
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
        } else if (text) {
          notifyUniversalShareIntent({
            type: 'text',
            title,
            caption: text,
            text,
            source: 'web-share-target'
          });
        } else {
          checkPendingShareTargets();
        }
      }
    });
  }

  // 5. Web Launch Queue API (for File Handling / PWA Share Target launches)
  if ('launchQueue' in window && (window as any).launchQueue?.setConsumer) {
    try {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (launchParams?.files && launchParams.files.length > 0) {
          const fileObjs: File[] = [];
          for (const handle of launchParams.files) {
            if (handle && typeof handle.getFile === 'function') {
              const file = await handle.getFile();
              if (file) fileObjs.push(file);
            }
          }
          if (fileObjs.length > 0) {
            const items = await processIncomingFilesForSharing(fileObjs);
            const onlyDocs = items.every(i => i.type === 'file');
            notifyUniversalShareIntent({
              type: onlyDocs ? 'file' : 'media',
              items,
              source: 'web-share-target'
            });
          }
        }
      });
    } catch {
      // ignore
    }
  }

  // 6. Native Android Capacitor App Lifecycle & Deep Link events
  if (Capacitor.isNativePlatform()) {
    try {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          checkPendingShareTargets();
        }
      });

      CapApp.addListener('appUrlOpen', async (data) => {
        if (await checkNativeAndroidShareBridge()) return;
        if (!data?.url) return;
        try {
          const parsed = new URL(data.url);
          const sharedUrl = parsed.searchParams.get('shared_url') || parsed.searchParams.get('url') || parsed.searchParams.get('link');
          const sharedText = parsed.searchParams.get('shared_text') || parsed.searchParams.get('text');
          const sharedTitle = parsed.searchParams.get('shared_title') || parsed.searchParams.get('title');

          if (sharedUrl || sharedText) {
            notifyUniversalShareIntent({
              type: sharedUrl ? 'link' : 'text',
              url: sharedUrl || undefined,
              title: sharedTitle || undefined,
              caption: sharedText || undefined,
              text: sharedText || undefined,
              source: 'android-share-sheet'
            });
          }
        } catch (e) {
          console.warn('Error parsing appUrlOpen data:', e);
        }
      });
    } catch (e) {
      console.warn('Capacitor App listener error:', e);
    }
  }

  // 7. Custom DOM events from Android WebView or in-app triggers
  window.addEventListener('connexa:universal-share', (e: any) => {
    if (e.detail) {
      // Remove any duplicate localStorage copy if also written
      try {
        localStorage.removeItem('connexa_pending_universal_share');
      } catch {
        // ignore
      }
      notifyUniversalShareIntent(e.detail);
    }
  });

  window.addEventListener('connexa:share-media', async (e: any) => {
    if (e.detail?.files) {
      const items = await processIncomingFilesForSharing(e.detail.files);
      if (items.length > 0 || e.detail.text) {
        const onlyDocs = items.length > 0 && items.every(i => i.type === 'file');
        notifyUniversalShareIntent({
          type: onlyDocs ? 'file' : 'media',
          items,
          caption: e.detail.text,
          text: e.detail.text,
          source: 'android-share-sheet'
        });
      }
    }
  });

  window.addEventListener('connexa:share-link', (e: any) => {
    const url = e.detail?.url || '';
    const text = e.detail?.text || '';
    const title = e.detail?.title || '';
    if (url || text) {
      notifyUniversalShareIntent({
        type: url ? 'link' : 'text',
        url: url || undefined,
        title: title || undefined,
        caption: text || undefined,
        text: text || undefined,
        source: 'android-share-sheet'
      });
    }
  });
}

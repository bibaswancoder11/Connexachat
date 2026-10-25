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
import {
  processVideoFile,
  generateVideoThumbnail,
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_SIZE_MB
} from './mediaUtils';
import {
  base64ToUint8Array,
  CHUNK_RAW_BYTES,
  prepareFileForUpload,
  readReadableStreamIntoChunks,
  readBlobIntoChunks,
  PreparedMediaSource
} from '../services/mediaStorageService';
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
    preparedSource: item.preparedSource,
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
          const preparedSource = await prepareFileForUpload(file, file.name || 'image.png', file.type || 'image/png');
          items.push({
            type: 'image',
            dataUrl: '',
            preparedSource,
            filename: file.name,
            size: preparedSource.size,
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
            preparedSource: meta.preparedSource,
            thumbnailUrl: meta.thumbnailUrl,
            duration: meta.duration,
            filename: file.name || meta.filename,
            size: meta.size,
            mimeType: meta.mimeType || file.type || 'video/mp4'
          });
        } catch (vidErr: any) {
          items.push({
            type: 'video',
            dataUrl: '',
            filename: file.name || 'video.mp4',
            size: file.size,
            mimeType: file.type || 'video/mp4',
            error: vidErr?.message || `Unable to read "${file.name || 'video'}". Please try sharing it again.`
          });
        }
      } else {
        // Document / PDF / Audio / Archive / Any file (up to 55MB via snapshotted 528KB chunks)
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
        try {
          const preparedSource = await prepareFileForUpload(
            file,
            file.name || 'Document',
            file.type || 'application/octet-stream'
          );
          items.push({
            type: 'file',
            dataUrl: '',
            preparedSource,
            filename: file.name || 'Document',
            size: preparedSource.size,
            mimeType: file.type || 'application/octet-stream'
          });
        } catch (docErr: any) {
          items.push({
            type: 'file',
            dataUrl: '',
            filename: file.name || 'Document',
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            error: docErr?.message || `Unable to read "${file.name || 'Document'}".`
          });
        }
      }
    } catch (err) {
      console.warn('Could not process shared file:', file.name, err);
    }
  }

  return items;
}

/**
 * Open IndexedDB v2 shared store (shares + share_chunks)
 */
function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('connexa_share_target_db', 2);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('share_chunks')) {
        const chunkStore = db.createObjectStore('share_chunks', { keyPath: 'key' });
        chunkStore.createIndex('by_share', 'shareId', { unique: false });
      }
    };
    request.onsuccess = (e: any) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAndDeleteSwShareChunks(
  db: IDBDatabase,
  shareId: string,
  chunkedFiles: Array<{
    fileIndex: number;
    category: 'image' | 'video' | 'file';
    filename: string;
    mimeType: string;
    size: number;
    chunkCount: number;
    error?: string;
  }>
): Promise<UniversalShareItem[]> {
  const results: UniversalShareItem[] = [];
  if (!db.objectStoreNames.contains('share_chunks')) {
    return results;
  }

  for (const cf of chunkedFiles) {
    if (cf.error) {
      results.push({
        type: cf.category,
        dataUrl: '',
        filename: cf.filename,
        size: cf.size,
        mimeType: cf.mimeType,
        error: cf.error
      });
      continue;
    }

    const chunks: Uint8Array[] = [];
    for (let cIdx = 0; cIdx < cf.chunkCount; cIdx++) {
      const key = `${shareId}_${cf.fileIndex}_${cIdx}`;
      const chunkData = await new Promise<ArrayBuffer | null>((resolve) => {
        try {
          const tx = db.transaction('share_chunks', 'readwrite');
          const store = tx.objectStore('share_chunks');
          const req = store.get(key);
          req.onsuccess = () => {
            const val = req.result?.data;
            store.delete(key);
            resolve(val instanceof ArrayBuffer ? val : null);
          };
          req.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      });

      if (chunkData) {
        chunks.push(new Uint8Array(chunkData));
      }
    }

    if (chunks.length === 0) {
      results.push({
        type: cf.category,
        dataUrl: '',
        filename: cf.filename,
        size: cf.size,
        mimeType: cf.mimeType,
        error: `Could not read "${cf.filename}". Please share it again.`
      });
      continue;
    }

    const actualSize = chunks.reduce((s, c) => s + c.byteLength, 0);
    const preparedSource: PreparedMediaSource = {
      size: actualSize,
      mimeType: cf.mimeType,
      filename: cf.filename,
      chunks
    };

    if (cf.category === 'image' && actualSize <= 15 * 1024 * 1024) {
      try {
        const imgFile = new File(chunks as BlobPart[], cf.filename, { type: cf.mimeType || 'image/jpeg' });
        const compressed = await compressImage(imgFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.84 });
        results.push({
          type: 'image',
          dataUrl: compressed,
          filename: cf.filename,
          size: actualSize,
          mimeType: 'image/jpeg'
        });
        continue;
      } catch {
        // Fallback to preparedSource
      }
    }

    let thumbnailUrl = '';
    let duration = 0;
    if (cf.category === 'video' && actualSize <= 30 * 1024 * 1024) {
      try {
        const tempBlob = new Blob(chunks as BlobPart[], { type: cf.mimeType || 'video/mp4' });
        const thumb = await generateVideoThumbnail(tempBlob);
        thumbnailUrl = thumb.thumbnail;
        duration = thumb.duration;
      } catch {
        // Non-fatal
      }
    }

    results.push({
      type: cf.category,
      dataUrl: '',
      preparedSource,
      filename: cf.filename,
      size: actualSize,
      mimeType: cf.mimeType,
      thumbnailUrl: thumbnailUrl || undefined,
      duration: duration || undefined
    });
  }

  return results;
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
    const rawRecord = await new Promise<any>((resolve) => {
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

    if (!rawRecord) return null;

    if (Array.isArray(rawRecord.chunkedFiles) && rawRecord.chunkedFiles.length > 0) {
      const hydratedSwItems = await readAndDeleteSwShareChunks(
        db,
        rawRecord.id,
        rawRecord.chunkedFiles
      );
      return {
        ...rawRecord,
        items: hydratedSwItems
      };
    }

    return rawRecord;
  } catch (err) {
    console.warn('Could not read from share target IndexedDB:', err);
    return null;
  }
}

/**
 * Hydrate any native Android temp-file references (nativeFileId) or server temp-file URLs (tempFileUrl)
 * WITHOUT ever creating a 50MB Blob/File in Chromium's BlobRegistry!
 */
async function hydrateExternalSharedItems(rawItems: any[], bridge?: any): Promise<UniversalShareItem[]> {
  const hydrated: UniversalShareItem[] = [];

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

    // 1. Native Android chunked file bridge (keeps 49-55MB videos on native disk until uploadLargeMedia streams them!)
    if (raw.nativeFileId && bridge && typeof bridge.getSharedFileChunkBase64 === 'function') {
      const totalSize = Number(raw.size || 0);
      const itemType: 'image' | 'video' | 'file' =
        raw.type === 'image' || raw.type === 'video' || raw.type === 'file' ? raw.type : 'file';

      // Compress small shared images (< 15MB) inline so preview & chat send are instant
      if (itemType === 'image' && totalSize > 0 && totalSize <= 15 * 1024 * 1024) {
        try {
          const parts: BlobPart[] = [];
          let offset = 0;
          while (offset < totalSize) {
            const b64Chunk = bridge.getSharedFileChunkBase64(raw.nativeFileId, offset, CHUNK_RAW_BYTES);
            if (!b64Chunk || typeof b64Chunk !== 'string') break;
            const bytes = base64ToUint8Array(b64Chunk);
            if (bytes.byteLength === 0) break;
            parts.push(bytes);
            offset += bytes.byteLength;
          }
          if (typeof bridge.deleteSharedTempFile === 'function') {
            try {
              bridge.deleteSharedTempFile(raw.nativeFileId);
            } catch {
              // ignore
            }
          }
          if (parts.length > 0) {
            const imgFile = new File(parts, raw.filename || 'shared_photo.jpg', {
              type: raw.mimeType || 'image/jpeg'
            });
            const compressed = await compressImage(imgFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.84 });
            hydrated.push({
              type: 'image',
              dataUrl: compressed,
              filename: raw.filename,
              size: totalSize,
              mimeType: 'image/jpeg'
            });
            continue;
          }
        } catch (imgErr) {
          console.warn('Native shared image compression fallback:', imgErr);
        }
      }

      // For ALL videos (up to 55MB, including 49.x MB) and documents/files:
      // Keep nativeFileId intact so uploadLargeMedia streams 528KB Base64 chunks directly over JNI with <2MB RAM!
      hydrated.push({
        type: itemType,
        dataUrl: '',
        preparedSource: {
          size: totalSize,
          mimeType: raw.mimeType || (itemType === 'video' ? 'video/mp4' : 'application/octet-stream'),
          filename: raw.filename || (itemType === 'video' ? 'shared_video.mp4' : 'shared_file'),
          nativeFileId: raw.nativeFileId
        },
        filename: raw.filename,
        size: totalSize,
        mimeType: raw.mimeType || (itemType === 'video' ? 'video/mp4' : 'application/octet-stream'),
        thumbnailUrl: raw.thumbnailUrl || undefined,
        duration: raw.duration ? Number(raw.duration) : undefined
      });
      continue;
    }

    // 2. Express fallback /api/shared-temp/:id binary stream -> stream directly into 528KB Uint8Array chunks!
    if (raw.tempFileUrl && typeof raw.tempFileUrl === 'string') {
      try {
        const consumeUrl = raw.tempFileUrl.includes('?')
          ? `${raw.tempFileUrl}&consume=1`
          : `${raw.tempFileUrl}?consume=1`;
        const resp = await fetch(consumeUrl);
        if (resp.ok) {
          let chunks: Uint8Array[] = [];
          let totalBytes = 0;
          if (resp.body) {
            const streamed = await readReadableStreamIntoChunks(resp.body, Number(raw.size || 0));
            chunks = streamed.chunks;
            totalBytes = streamed.totalBytes;
          } else {
            const b = await resp.blob();
            chunks = await readBlobIntoChunks(b);
            totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
          }

          if (chunks.length > 0) {
            const itemType: 'image' | 'video' | 'file' =
              raw.type === 'image' || raw.type === 'video' || raw.type === 'file' ? raw.type : 'file';
            const mime = raw.mimeType || resp.headers.get('content-type') || 'application/octet-stream';
            const filename = raw.filename || 'shared_file';

            if (itemType === 'image' && totalBytes <= 15 * 1024 * 1024) {
              try {
                const imgFile = new File(chunks as BlobPart[], filename, { type: mime });
                const compressed = await compressImage(imgFile, { maxWidth: 1280, maxHeight: 1280, quality: 0.84 });
                hydrated.push({
                  type: 'image',
                  dataUrl: compressed,
                  filename,
                  size: totalBytes,
                  mimeType: 'image/jpeg'
                });
                continue;
              } catch {
                // fallback to preparedSource
              }
            }

            let thumbnailUrl = '';
            let duration = 0;
            if (itemType === 'video' && totalBytes <= 30 * 1024 * 1024) {
              try {
                const tempBlob = new Blob(chunks as BlobPart[], { type: mime });
                const thumb = await generateVideoThumbnail(tempBlob);
                thumbnailUrl = thumb.thumbnail;
                duration = thumb.duration;
              } catch {
                // ignore
              }
            }

            hydrated.push({
              type: itemType,
              dataUrl: '',
              preparedSource: {
                size: totalBytes,
                mimeType: mime,
                filename,
                chunks
              },
              filename,
              size: totalBytes,
              mimeType: mime,
              thumbnailUrl: thumbnailUrl || undefined,
              duration: duration || undefined
            });
            continue;
          }
        }
      } catch (err) {
        console.warn('Failed fetching temp shared file:', err);
      }
    }

    hydrated.push(raw as UniversalShareItem);
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
        if (files && files.length > 0) {
          if (shareId) {
            fetchAndClearSharedRecord(shareId).catch(() => {});
          }
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
        } else if (shareId) {
          const record = await fetchAndClearSharedRecord(shareId);
          if (record && record.items && record.items.length > 0) {
            const hydratedItems = await hydrateExternalSharedItems(record.items);
            const hasDoc =
              hydratedItems.some(i => i.type === 'file') &&
              !hydratedItems.some(i => i.type === 'image' || i.type === 'video');
            notifyUniversalShareIntent({
              type: hasDoc ? 'file' : 'media',
              items: hydratedItems,
              title: record.title || title,
              caption: record.text || text,
              text: record.text || text,
              source: 'web-share-target'
            });
          } else {
            checkPendingShareTargets();
          }
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

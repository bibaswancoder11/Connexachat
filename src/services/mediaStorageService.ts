import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from '../firebase';

/**
 * Maximum allowed video size: 55 MB (57,671,680 bytes)
 */
export const MAX_VIDEO_SIZE_MB = 55;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

/**
 * 528 KB (540,672 bytes) per raw binary chunk.
 * 540,672 is an exact multiple of 3, producing 720,896 Base64 characters (~704 KB)
 * with zero mid-stream '=' padding and staying well below Firestore's 1 MiB document cap.
 * A 55 MB video splits into at most 107 chunks.
 */
export const CHUNK_RAW_BYTES = 540672;
export const MAX_TOTAL_CHUNKS = Math.ceil(MAX_VIDEO_SIZE_BYTES / CHUNK_RAW_BYTES) + 5; // 112 safety ceiling
export const INLINE_BINARY_THRESHOLD_BYTES = 480 * 1024; // <= 480 KB raw stays inline
export const INLINE_DATA_URL_MAX_CHARS = 700000;
export const CHUNKED_MEDIA_PREFIX = 'connexa-media://';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestorePermissionError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function rethrowIfPermissionDenied(error: unknown, operationType: OperationType, path: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.toLowerCase().includes('missing or insufficient permissions') || msg.toLowerCase().includes('permission-denied')) {
    handleFirestorePermissionError(error, operationType, path);
  }
}

export function isChunkedMediaUrl(url?: string | null): boolean {
  return Boolean(url && url.startsWith(CHUNKED_MEDIA_PREFIX));
}

export function extractMediaIdFromUrl(url: string): string {
  return url.slice(CHUNKED_MEDIA_PREFIX.length).trim();
}

function padChunkIndex(index: number): string {
  return String(index).padStart(4, '0');
}

/**
 * In-memory ObjectURL cache for zero-latency playback during session
 */
const memoryObjectUrlCache = new Map<string, { objectUrl: string; blob: Blob; mimeType: string; filename?: string }>();
const inFlightDownloads = new Map<string, Promise<{ objectUrl: string; blob: Blob; mimeType: string; filename?: string }>>();

const MEDIA_CACHE_DB_NAME = 'connexa_media_cache_db';
const MEDIA_CACHE_STORE = 'media_blobs';

function openMediaCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(MEDIA_CACHE_DB_NAME, 1);
    req.onupgradeneeded = (e: any) => {
      const database = e.target.result as IDBDatabase;
      if (!database.objectStoreNames.contains(MEDIA_CACHE_STORE)) {
        database.createObjectStore(MEDIA_CACHE_STORE, { keyPath: 'mediaId' });
      }
    };
    req.onsuccess = (e: any) => resolve(e.target.result as IDBDatabase);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheMediaBlobLocally(
  mediaId: string,
  blob: Blob,
  mimeType?: string,
  filename?: string
): Promise<string> {
  const existing = memoryObjectUrlCache.get(mediaId);
  if (existing) {
    return existing.objectUrl;
  }

  const resolvedMime = mimeType || blob.type || 'video/mp4';
  const typedBlob = blob.type === resolvedMime ? blob : new Blob([blob], { type: resolvedMime });
  const objectUrl = URL.createObjectURL(typedBlob);

  memoryObjectUrlCache.set(mediaId, {
    objectUrl,
    blob: typedBlob,
    mimeType: resolvedMime,
    filename
  });

  try {
    const database = await openMediaCacheDb();
    await new Promise<void>((resolve) => {
      const tx = database.transaction(MEDIA_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(MEDIA_CACHE_STORE);
      store.put({
        mediaId,
        blob: typedBlob,
        mimeType: resolvedMime,
        filename: filename || '',
        cachedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Non-fatal if IndexedDB quota is tight; in-memory objectUrl still works
  }

  return objectUrl;
}

export function peekCachedMediaObjectUrl(mediaUrl?: string | null): string | null {
  if (!mediaUrl || !isChunkedMediaUrl(mediaUrl)) return null;
  const mediaId = extractMediaIdFromUrl(mediaUrl);
  return memoryObjectUrlCache.get(mediaId)?.objectUrl || null;
}

export async function getCachedMediaEntry(
  mediaUrl: string
): Promise<{ objectUrl: string; blob: Blob; mimeType: string; filename?: string } | null> {
  if (!isChunkedMediaUrl(mediaUrl)) return null;
  const mediaId = extractMediaIdFromUrl(mediaUrl);

  const mem = memoryObjectUrlCache.get(mediaId);
  if (mem) return mem;

  try {
    const database = await openMediaCacheDb();
    const record = await new Promise<any>((resolve) => {
      const tx = database.transaction(MEDIA_CACHE_STORE, 'readonly');
      const req = tx.objectStore(MEDIA_CACHE_STORE).get(mediaId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    if (record && record.blob instanceof Blob) {
      const mimeType = record.mimeType || record.blob.type || 'video/mp4';
      const objectUrl = URL.createObjectURL(record.blob);
      const entry = {
        objectUrl,
        blob: record.blob as Blob,
        mimeType,
        filename: record.filename || undefined
      };
      memoryObjectUrlCache.set(mediaId, entry);
      return entry;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Convert an ArrayBuffer (up to ~540 KB) to Base64 without call stack overflow or huge intermediate strings
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const step = 0x8000; // 32 KB chunks for String.fromCharCode
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += step) {
    const sub = bytes.subarray(i, Math.min(i + step, bytes.length));
    parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  return btoa(parts.join(''));
}

/**
 * Convert a Base64 string chunk to a Uint8Array backed by a standard ArrayBuffer
 */
export function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a data: URL to a Blob without fetching if large
 */
export async function dataUrlToBlob(dataUrl: string): Promise<{ blob: Blob; mimeType: string }> {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Invalid media data URL.');
  }
  const header = dataUrl.slice(0, commaIdx);
  const mimeMatch = header.match(/^data:([^;]+)/i);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const isBase64 = header.includes(';base64');

  if (!isBase64) {
    const resp = await fetch(dataUrl);
    const b = await resp.blob();
    return { blob: b, mimeType: b.type || mimeType };
  }

  const rawB64 = dataUrl.slice(commaIdx + 1);
  // Decode in multiples of 4 chars (~720 KB slices) so even a 75 MB dataUrl doesn't spike memory
  const sliceChars = 720896; // divisible by 4
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < rawB64.length; offset += sliceChars) {
    const partB64 = rawB64.slice(offset, offset + sliceChars);
    parts.push(base64ToUint8Array(partB64));
  }
  return { blob: new Blob(parts, { type: mimeType }), mimeType };
}

async function blobToInlineDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode small media clip.'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading media clip.'));
    reader.readAsDataURL(blob);
  });
}

export interface UploadLargeMediaOptions {
  blob?: Blob | File;
  dataUrl?: string;
  mimeType?: string;
  filename?: string;
  uploaderId: string;
  onProgress?: (percent: number) => void;
}

/**
 * Uploads videos or large files (up to 55 MB) into Firestore chunked media storage.
 * Small payloads (<= 480 KB) are returned as inline data URLs for instant rendering.
 */
export async function uploadLargeMedia(options: UploadLargeMediaOptions): Promise<string> {
  const { uploaderId, onProgress } = options;

  if (options.dataUrl && isChunkedMediaUrl(options.dataUrl)) {
    onProgress?.(100);
    return options.dataUrl;
  }

  let sourceBlob: Blob | null = options.blob || null;
  let resolvedMime = options.mimeType || sourceBlob?.type || '';

  if (!sourceBlob && options.dataUrl) {
    if (options.dataUrl.startsWith('data:') && options.dataUrl.length <= INLINE_DATA_URL_MAX_CHARS) {
      onProgress?.(100);
      return options.dataUrl;
    }
    if (options.dataUrl.startsWith('blob:')) {
      const resp = await fetch(options.dataUrl);
      sourceBlob = await resp.blob();
      resolvedMime = resolvedMime || sourceBlob.type || 'video/mp4';
    } else if (options.dataUrl.startsWith('data:')) {
      const converted = await dataUrlToBlob(options.dataUrl);
      sourceBlob = converted.blob;
      resolvedMime = resolvedMime || converted.mimeType;
    } else {
      // External https:// URL
      onProgress?.(100);
      return options.dataUrl;
    }
  }

  if (!sourceBlob) {
    throw new Error('No media data provided for upload.');
  }

  if (sourceBlob.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(
      `File is too large (${(sourceBlob.size / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
    );
  }

  // Keep tiny files inline so small images/voice notes render with zero extra roundtrips
  if (sourceBlob.size <= INLINE_BINARY_THRESHOLD_BYTES) {
    const inlineUrl =
      options.dataUrl && options.dataUrl.startsWith('data:') && options.dataUrl.length <= INLINE_DATA_URL_MAX_CHARS
        ? options.dataUrl
        : await blobToInlineDataUrl(sourceBlob);
    onProgress?.(100);
    return inlineUrl;
  }

  const finalMime = (resolvedMime || 'video/mp4').slice(0, 120);
  const safeFilename = (
    options.filename ||
    (sourceBlob instanceof File ? sourceBlob.name : '') ||
    (finalMime.startsWith('video/') ? 'video.mp4' : 'attachment')
  ).slice(0, 240);

  const totalChunks = Math.ceil(sourceBlob.size / CHUNK_RAW_BYTES);
  const mediaId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const assetPath = `mediaAssets/${mediaId}`;
  const assetRef = doc(db, 'mediaAssets', mediaId);

  onProgress?.(2);

  try {
    await setDoc(assetRef, {
      id: mediaId,
      uploaderId: (uploaderId || 'anonymous').slice(0, 128),
      mimeType: finalMime,
      filename: safeFilename,
      size: sourceBlob.size,
      chunkSize: CHUNK_RAW_BYTES,
      totalChunks,
      status: 'uploading',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    rethrowIfPermissionDenied(err, OperationType.CREATE, assetPath);
    throw err;
  }

  // Upload chunks in small writeBatches of 6 chunks (~4.3 MB per batch, well below Firestore's 10 MiB batch limit)
  // with 2 concurrent batch workers and automatic per-chunk fallback retry for cellular resilience.
  const BATCH_CHUNK_COUNT = 6;
  const batchRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < totalChunks; i += BATCH_CHUNK_COUNT) {
    batchRanges.push({ start: i, end: Math.min(i + BATCH_CHUNK_COUNT, totalChunks) });
  }

  let uploadedChunks = 0;
  let nextRangeIndex = 0;

  const uploadSingleRange = async (start: number, end: number) => {
    const chunkPayloads: Array<{ index: number; docId: string; base64: string }> = [];
    for (let idx = start; idx < end; idx++) {
      const byteStart = idx * CHUNK_RAW_BYTES;
      const byteEnd = Math.min(byteStart + CHUNK_RAW_BYTES, sourceBlob!.size);
      const sliceBuf = await sourceBlob!.slice(byteStart, byteEnd).arrayBuffer();
      chunkPayloads.push({
        index: idx,
        docId: padChunkIndex(idx),
        base64: arrayBufferToBase64(sliceBuf)
      });
    }

    try {
      const batch = writeBatch(db);
      for (const item of chunkPayloads) {
        const chunkRef = doc(db, 'mediaAssets', mediaId, 'chunks', item.docId);
        batch.set(chunkRef, {
          index: item.index,
          data: item.base64
        });
      }
      await batch.commit();
      uploadedChunks += chunkPayloads.length;
      const pct = Math.min(98, Math.max(4, Math.round((uploadedChunks / totalChunks) * 96)));
      onProgress?.(pct);
    } catch (batchErr) {
      rethrowIfPermissionDenied(batchErr, OperationType.WRITE, `${assetPath}/chunks`);
      // Fallback: write each chunk individually with retry on transient network error
      for (const item of chunkPayloads) {
        const chunkPath = `${assetPath}/chunks/${item.docId}`;
        const chunkRef = doc(db, 'mediaAssets', mediaId, 'chunks', item.docId);
        let attempt = 0;
        while (true) {
          try {
            await setDoc(chunkRef, {
              index: item.index,
              data: item.base64
            });
            uploadedChunks += 1;
            const pct = Math.min(98, Math.max(4, Math.round((uploadedChunks / totalChunks) * 96)));
            onProgress?.(pct);
            break;
          } catch (singleErr) {
            rethrowIfPermissionDenied(singleErr, OperationType.WRITE, chunkPath);
            attempt++;
            if (attempt >= 3) throw singleErr;
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }
    }
  };

  const WORKER_CONCURRENCY = 2;
  const workers = Array.from({ length: Math.min(WORKER_CONCURRENCY, batchRanges.length) }, async () => {
    while (nextRangeIndex < batchRanges.length) {
      const current = batchRanges[nextRangeIndex++];
      await uploadSingleRange(current.start, current.end);
    }
  });

  await Promise.all(workers);

  try {
    await updateDoc(assetRef, {
      status: 'ready'
    });
  } catch (err) {
    rethrowIfPermissionDenied(err, OperationType.UPDATE, assetPath);
    throw err;
  }

  // Cache locally so the sender can play/view immediately with 0ms latency
  await cacheMediaBlobLocally(mediaId, sourceBlob, finalMime, safeFilename);
  onProgress?.(100);

  return `${CHUNKED_MEDIA_PREFIX}${mediaId}`;
}

/**
 * Downloads and reassembles a chunked media asset into a fast, seekable Blob ObjectURL.
 */
export async function resolveChunkedMediaToObjectUrl(
  mediaUrl: string,
  onProgress?: (percent: number) => void
): Promise<{ objectUrl: string; blob: Blob; mimeType: string; filename?: string }> {
  if (!isChunkedMediaUrl(mediaUrl)) {
    throw new Error('URL is not a chunked media reference.');
  }

  const cached = await getCachedMediaEntry(mediaUrl);
  if (cached) {
    onProgress?.(100);
    return cached;
  }

  const mediaId = extractMediaIdFromUrl(mediaUrl);
  const existingFlight = inFlightDownloads.get(mediaId);
  if (existingFlight) {
    return existingFlight;
  }

  const downloadPromise = (async () => {
    const assetPath = `mediaAssets/${mediaId}`;
    const assetRef = doc(db, 'mediaAssets', mediaId);

    let assetSnap;
    try {
      assetSnap = await getDoc(assetRef);
    } catch (err) {
      rethrowIfPermissionDenied(err, OperationType.GET, assetPath);
      throw err;
    }

    if (!assetSnap.exists()) {
      throw new Error('Shared media file is no longer available.');
    }

    const meta = assetSnap.data() as {
      mimeType?: string;
      filename?: string;
      totalChunks?: number;
      status?: string;
    };

    const totalChunks = Number(meta.totalChunks || 0);
    if (totalChunks <= 0) {
      throw new Error('Invalid media metadata.');
    }

    const mimeType = meta.mimeType || 'video/mp4';
    const filename = meta.filename || undefined;
    const orderedParts: BlobPart[] = new Array(totalChunks);

    let loadedCount = 0;
    let nextChunkIdx = 0;
    onProgress?.(2);

    const DOWNLOAD_CONCURRENCY = 10;
    const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, totalChunks) }, async () => {
      while (nextChunkIdx < totalChunks) {
        const idx = nextChunkIdx++;
        const docId = padChunkIndex(idx);
        const chunkPath = `${assetPath}/chunks/${docId}`;
        const chunkRef = doc(db, 'mediaAssets', mediaId, 'chunks', docId);

        let attempt = 0;
        while (true) {
          try {
            const snap = await getDoc(chunkRef);
            if (!snap.exists()) {
              throw new Error(`Missing media chunk ${idx + 1}/${totalChunks}`);
            }
            const chunkData = snap.data() as { data?: string };
            if (!chunkData.data) {
              throw new Error(`Empty media chunk ${idx + 1}/${totalChunks}`);
            }
            orderedParts[idx] = base64ToUint8Array(chunkData.data);
            loadedCount++;
            onProgress?.(Math.min(99, Math.max(3, Math.round((loadedCount / totalChunks) * 98))));
            break;
          } catch (err) {
            rethrowIfPermissionDenied(err, OperationType.GET, chunkPath);
            attempt++;
            if (attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 350 * attempt));
          }
        }
      }
    });

    await Promise.all(workers);

    const fullBlob = new Blob(orderedParts, { type: mimeType });
    const objectUrl = await cacheMediaBlobLocally(mediaId, fullBlob, mimeType, filename);
    onProgress?.(100);

    return {
      objectUrl,
      blob: fullBlob,
      mimeType,
      filename
    };
  })();

  inFlightDownloads.set(mediaId, downloadPromise);
  try {
    return await downloadPromise;
  } finally {
    inFlightDownloads.delete(mediaId);
  }
}

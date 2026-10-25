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

export interface PreparedMediaSource {
  size: number;
  mimeType: string;
  filename: string;
  /** Pre-read 528 KB Uint8Array chunks in standard heap (immune to Android content:// expiration & Chromium ~48MB BlobRegistry cap) */
  chunks?: Uint8Array[];
  /** Native Android temp file ID in getCacheDir()/connexa_shared_cache — streamed chunk-by-chunk directly over JNI */
  nativeFileId?: string;
}

/**
 * Releases any native temporary file or in-memory buffers held by a PreparedMediaSource
 */
export function releasePreparedMediaSource(source?: PreparedMediaSource | null): void {
  if (!source) return;
  if (source.nativeFileId && typeof window !== 'undefined') {
    try {
      const bridge = (window as any).ConnexaAndroidShare;
      if (bridge && typeof bridge.deleteSharedTempFile === 'function') {
        bridge.deleteSharedTempFile(source.nativeFileId);
      }
    } catch {
      // ignore
    }
    source.nativeFileId = undefined;
  }
}

function sanitizeOpfsKey(mediaId: string): string {
  return mediaId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function writeChunksToOpfsBlob(
  mediaId: string,
  chunks: Uint8Array[],
  mimeType: string
): Promise<{ blob: Blob; opfsKey: string } | null> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== 'function'
    ) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('connexa_media_blobs', { create: true });
    const opfsKey = sanitizeOpfsKey(mediaId);
    const fileHandle = await dir.getFileHandle(opfsKey, { create: true });
    if (typeof (fileHandle as any).createWritable !== 'function') {
      return null;
    }
    const writable = await (fileHandle as any).createWritable();
    let expectedBytes = 0;
    for (const chunk of chunks) {
      if (chunk && chunk.byteLength > 0) {
        await writable.write(chunk);
        expectedBytes += chunk.byteLength;
      }
    }
    await writable.close();
    const diskFile = await fileHandle.getFile();
    if (diskFile.size !== expectedBytes || expectedBytes === 0) {
      return null;
    }
    return {
      blob: diskFile.slice(0, diskFile.size, mimeType),
      opfsKey
    };
  } catch {
    return null;
  }
}

async function readOpfsBlobByKey(opfsKey: string, mimeType: string): Promise<Blob | null> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== 'function'
    ) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('connexa_media_blobs', { create: false });
    const fileHandle = await dir.getFileHandle(opfsKey, { create: false });
    const diskFile = await fileHandle.getFile();
    if (!diskFile || diskFile.size <= 0) return null;
    return diskFile.slice(0, diskFile.size, mimeType);
  } catch {
    return null;
  }
}

async function isBlobReadable(blob: Blob): Promise<boolean> {
  if (blob.size === 0) return false;
  try {
    const probe = blob.slice(0, Math.min(16, blob.size));
    const buf = await probe.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

export async function cacheMediaBlobLocally(
  mediaId: string,
  blobOrChunks: Blob | Uint8Array[],
  mimeType?: string,
  filename?: string
): Promise<string> {
  const existing = memoryObjectUrlCache.get(mediaId);
  if (existing) {
    return existing.objectUrl;
  }

  const resolvedMime =
    mimeType ||
    (!Array.isArray(blobOrChunks) && blobOrChunks.type ? blobOrChunks.type : '') ||
    'video/mp4';

  let typedBlob: Blob | null = null;
  let opfsKey: string | undefined;

  try {
    if (Array.isArray(blobOrChunks)) {
      const totalBytes = blobOrChunks.reduce((sum, c) => sum + c.byteLength, 0);
      // For >20 MB videos/files, prefer OPFS disk-backed File so Chromium's RAM BlobRegistry (~45-48 MB limit on Android) is never exhausted
      if (totalBytes > 20 * 1024 * 1024) {
        const opfsRes = await writeChunksToOpfsBlob(mediaId, blobOrChunks, resolvedMime);
        if (opfsRes) {
          typedBlob = opfsRes.blob;
          opfsKey = opfsRes.opfsKey;
        }
      }
      if (!typedBlob) {
        typedBlob = new Blob(blobOrChunks as BlobPart[], { type: resolvedMime });
      }
    } else {
      typedBlob =
        blobOrChunks.type === resolvedMime
          ? blobOrChunks
          : new Blob([blobOrChunks], { type: resolvedMime });
    }
  } catch {
    return '';
  }

  if (!typedBlob || !(await isBlobReadable(typedBlob))) {
    return '';
  }

  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(typedBlob);
    memoryObjectUrlCache.set(mediaId, {
      objectUrl,
      blob: typedBlob,
      mimeType: resolvedMime,
      filename
    });
  } catch {
    return '';
  }

  // Persist <= 20 MB Blobs directly in IndexedDB, or store lightweight OPFS pointer metadata for > 20 MB files
  if (typedBlob.size <= 20 * 1024 * 1024 || opfsKey) {
    try {
      const database = await openMediaCacheDb();
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        try {
          const tx = database.transaction(MEDIA_CACHE_STORE, 'readwrite');
          const store = tx.objectStore(MEDIA_CACHE_STORE);
          store.put(
            opfsKey
              ? {
                  mediaId,
                  opfsKey,
                  mimeType: resolvedMime,
                  filename: filename || '',
                  cachedAt: Date.now()
                }
              : {
                  mediaId,
                  blob: typedBlob,
                  mimeType: resolvedMime,
                  filename: filename || '',
                  cachedAt: Date.now()
                }
          );
          tx.oncomplete = done;
          tx.onerror = done;
          tx.onabort = done;
        } catch {
          done();
        }
      });
    } catch {
      // Non-fatal if IndexedDB quota is tight; in-memory objectUrl still works
    }
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
      tx.onabort = () => resolve(null);
    });

    if (record) {
      const mimeType = record.mimeType || 'video/mp4';
      let cachedBlob: Blob | null = null;
      if (record.opfsKey && typeof record.opfsKey === 'string') {
        cachedBlob = await readOpfsBlobByKey(record.opfsKey, mimeType);
      } else if (record.blob instanceof Blob) {
        cachedBlob = record.blob;
      }

      if (cachedBlob && (await isBlobReadable(cachedBlob))) {
        const objectUrl = URL.createObjectURL(cachedBlob);
        const entry = {
          objectUrl,
          blob: cachedBlob,
          mimeType,
          filename: record.filename || undefined
        };
        memoryObjectUrlCache.set(mediaId, entry);
        return entry;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Convert an ArrayBuffer or Uint8Array (up to ~540 KB) to Base64 without call stack overflow or huge intermediate strings
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
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

function readSliceViaFileReader(slice: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return an ArrayBuffer.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed to read slice.'));
    reader.onabort = () => reject(new Error('FileReader slice read aborted.'));
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Reads any ReadableStream<Uint8Array> sequentially into exact CHUNK_RAW_BYTES (528 KB) Uint8Array chunks
 * without ever allocating a contiguous 50 MB buffer or registering a 50 MB Blob in Chromium's BlobRegistry.
 */
export async function readReadableStreamIntoChunks(
  stream: ReadableStream<Uint8Array>,
  expectedSize?: number,
  onReadProgress?: (percent: number) => void
): Promise<{ chunks: Uint8Array[]; totalBytes: number }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let currentBuf = new Uint8Array(CHUNK_RAW_BYTES);
  let currentOffset = 0;
  let totalBytes = 0;

  try {
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

        if (totalBytes > MAX_VIDEO_SIZE_BYTES) {
          throw new Error(
            `File is too large (${(totalBytes / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
          );
        }

        if (currentOffset === CHUNK_RAW_BYTES) {
          chunks.push(currentBuf);
          currentBuf = new Uint8Array(CHUNK_RAW_BYTES);
          currentOffset = 0;
        }
      }

      if (expectedSize && expectedSize > 0 && onReadProgress) {
        onReadProgress(Math.min(99, Math.round((totalBytes / expectedSize) * 100)));
      }
    }

    if (currentOffset > 0) {
      chunks.push(currentBuf.slice(0, currentOffset));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return { chunks, totalBytes };
}

/**
 * 3-tier resilient reader that converts a File/Blob (including 49-55 MB Android content:// URIs,
 * Photo Picker handles, and cloud-backed streams) into 528 KB Uint8Array chunks immediately while
 * the OS file descriptor is fresh.
 */
export async function readBlobIntoChunks(
  blob: Blob | File,
  onReadProgress?: (percent: number) => void
): Promise<Uint8Array[]> {
  if (blob.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(
      `File is too large (${(blob.size / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
    );
  }

  // Tier 1: Sequential ReadableStream (works with non-seekable Android content:// pipes & avoids Blob.slice issues)
  if (typeof blob.stream === 'function') {
    try {
      const { chunks, totalBytes } = await readReadableStreamIntoChunks(
        blob.stream(),
        blob.size,
        onReadProgress
      );
      if (totalBytes > 0 && chunks.length > 0) {
        onReadProgress?.(100);
        return chunks;
      }
    } catch (streamErr: any) {
      if (streamErr?.message?.includes('Maximum supported size')) {
        throw streamErr;
      }
      console.warn('Stream chunk read fallback triggered:', streamErr);
    }
  }

  // Tier 2: Sequential 528 KB slice reader using FileReader + slice.arrayBuffer() fallback
  try {
    const totalChunks = Math.ceil(blob.size / CHUNK_RAW_BYTES);
    const chunks: Uint8Array[] = [];
    for (let idx = 0; idx < totalChunks; idx++) {
      const start = idx * CHUNK_RAW_BYTES;
      const end = Math.min(start + CHUNK_RAW_BYTES, blob.size);
      const slice = blob.slice(start, end);

      let buf: ArrayBuffer;
      try {
        buf = await readSliceViaFileReader(slice);
      } catch {
        buf = await slice.arrayBuffer();
      }
      chunks.push(new Uint8Array(buf));
      onReadProgress?.(Math.min(99, Math.round(((idx + 1) / totalChunks) * 100)));
    }
    if (chunks.length > 0) {
      onReadProgress?.(100);
      return chunks;
    }
  } catch (sliceErr) {
    console.warn('Slice FileReader fallback triggered:', sliceErr);
  }

  // Tier 3: Response(blob).arrayBuffer() full sequential read partitioned into 528 KB chunks
  try {
    const fullBuffer = await new Response(blob).arrayBuffer();
    if (fullBuffer.byteLength > 0) {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < fullBuffer.byteLength; offset += CHUNK_RAW_BYTES) {
        const end = Math.min(offset + CHUNK_RAW_BYTES, fullBuffer.byteLength);
        chunks.push(new Uint8Array(fullBuffer.slice(offset, end)));
      }
      onReadProgress?.(100);
      return chunks;
    }
  } catch (respErr) {
    console.warn('Response(blob) fallback failed:', respErr);
  }

  throw new Error(
    'Unable to read the selected file because Android/browser revoked temporary access. Please select the video from your device storage and send again.'
  );
}

/**
 * Snapshots a File/Blob immediately upon selection/share into 528 KB Uint8Array chunks so
 * subsequent <input> resets, thumbnail generation, or delays in UniversalShareModal never cause NotReadableError.
 */
export async function prepareFileForUpload(
  file: File | Blob,
  filename?: string,
  mimeType?: string,
  onReadProgress?: (percent: number) => void
): Promise<PreparedMediaSource> {
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
    );
  }

  const chunks = await readBlobIntoChunks(file, onReadProgress);
  const actualBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const resolvedName =
    filename || (file instanceof File && file.name ? file.name : 'video.mp4');
  const resolvedMime =
    mimeType || file.type || (resolvedName.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');

  return {
    size: actualBytes || file.size,
    mimeType: resolvedMime,
    filename: resolvedName,
    chunks
  };
}

/**
 * Convert a data: URL to 528 KB Uint8Array chunks without registering a huge Blob
 */
export async function dataUrlToChunks(dataUrl: string): Promise<{ chunks: Uint8Array[]; size: number; mimeType: string }> {
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
    const chunks = await readBlobIntoChunks(b);
    const size = chunks.reduce((s, c) => s + c.byteLength, 0);
    return { chunks, size, mimeType: b.type || mimeType };
  }

  const rawB64 = dataUrl.slice(commaIdx + 1);
  // 720,896 Base64 chars === 540,672 raw bytes (CHUNK_RAW_BYTES)
  const sliceChars = 720896;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let offset = 0; offset < rawB64.length; offset += sliceChars) {
    const partB64 = rawB64.slice(offset, offset + sliceChars);
    const arr = base64ToUint8Array(partB64);
    chunks.push(arr);
    size += arr.byteLength;
  }
  return { chunks, size, mimeType };
}

export async function dataUrlToBlob(dataUrl: string): Promise<{ blob: Blob; mimeType: string }> {
  const { chunks, mimeType } = await dataUrlToChunks(dataUrl);
  return { blob: new Blob(chunks as BlobPart[], { type: mimeType }), mimeType };
}

async function blobToInlineDataUrl(blob: Blob): Promise<string> {
  const chunks = await readBlobIntoChunks(blob);
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.byteLength;
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${arrayBufferToBase64(merged)}`;
}

function chunksToInlineDataUrl(chunks: Uint8Array[], mimeType: string): string {
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.byteLength;
  }
  return `data:${mimeType || 'application/octet-stream'};base64,${arrayBufferToBase64(merged)}`;
}

export interface UploadLargeMediaOptions {
  preparedSource?: PreparedMediaSource;
  blob?: Blob | File;
  dataUrl?: string;
  mimeType?: string;
  filename?: string;
  uploaderId: string;
  onProgress?: (percent: number) => void;
}

/**
 * Uploads videos or large files (up to 55 MB) into Firestore chunked media storage.
 * Supports streaming directly from Native Android Share cache (nativeFileId) or pre-read Uint8Array[] chunks
 * with zero NotReadableError failures on 49-55 MB videos.
 */
export async function uploadLargeMedia(options: UploadLargeMediaOptions): Promise<string> {
  const { uploaderId, onProgress } = options;

  if (options.dataUrl && isChunkedMediaUrl(options.dataUrl)) {
    onProgress?.(100);
    return options.dataUrl;
  }

  const nativeBridge =
    typeof window !== 'undefined' ? (window as any).ConnexaAndroidShare : undefined;
  const nativeFileId = options.preparedSource?.nativeFileId;
  const canStreamNativeFile = Boolean(
    nativeFileId &&
      nativeBridge &&
      typeof nativeBridge.getSharedFileChunkBase64 === 'function'
  );

  let preReadChunks: Uint8Array[] | null = options.preparedSource?.chunks || null;
  let totalBytes = options.preparedSource?.size || 0;
  let resolvedMime =
    options.mimeType ||
    options.preparedSource?.mimeType ||
    options.blob?.type ||
    '';

  if (!canStreamNativeFile && !preReadChunks) {
    if (options.blob) {
      preReadChunks = await readBlobIntoChunks(options.blob);
      totalBytes = preReadChunks.reduce((sum, c) => sum + c.byteLength, 0);
      resolvedMime = resolvedMime || options.blob.type || '';
    } else if (options.dataUrl) {
      if (options.dataUrl.startsWith('data:') && options.dataUrl.length <= INLINE_DATA_URL_MAX_CHARS) {
        onProgress?.(100);
        return options.dataUrl;
      }
      if (options.dataUrl.startsWith('blob:')) {
        const resp = await fetch(options.dataUrl);
        const fetchedBlob = await resp.blob();
        preReadChunks = await readBlobIntoChunks(fetchedBlob);
        totalBytes = preReadChunks.reduce((sum, c) => sum + c.byteLength, 0);
        resolvedMime = resolvedMime || fetchedBlob.type || 'video/mp4';
      } else if (options.dataUrl.startsWith('data:')) {
        const converted = await dataUrlToChunks(options.dataUrl);
        preReadChunks = converted.chunks;
        totalBytes = converted.size;
        resolvedMime = resolvedMime || converted.mimeType;
      } else {
        // External https:// URL
        onProgress?.(100);
        return options.dataUrl;
      }
    }
  }

  if (!canStreamNativeFile && (!preReadChunks || preReadChunks.length === 0 || totalBytes <= 0)) {
    throw new Error('No media data provided for upload.');
  }

  if (totalBytes > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(
      `File is too large (${(totalBytes / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
    );
  }

  const finalMime = (resolvedMime || 'video/mp4').slice(0, 120);

  // Keep tiny files inline so small images/voice notes render with zero extra roundtrips
  if (!canStreamNativeFile && preReadChunks && totalBytes <= INLINE_BINARY_THRESHOLD_BYTES) {
    const inlineUrl =
      options.dataUrl && options.dataUrl.startsWith('data:') && options.dataUrl.length <= INLINE_DATA_URL_MAX_CHARS
        ? options.dataUrl
        : chunksToInlineDataUrl(preReadChunks, finalMime);
    onProgress?.(100);
    return inlineUrl;
  }

  const safeFilename = (
    options.filename ||
    options.preparedSource?.filename ||
    (options.blob instanceof File ? options.blob.name : '') ||
    (finalMime.startsWith('video/') ? 'video.mp4' : 'attachment')
  ).slice(0, 240);

  const totalChunks = canStreamNativeFile
    ? Math.ceil(totalBytes / CHUNK_RAW_BYTES)
    : preReadChunks!.length;

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
      size: totalBytes,
      chunkSize: CHUNK_RAW_BYTES,
      totalChunks,
      status: 'uploading',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    rethrowIfPermissionDenied(err, OperationType.CREATE, assetPath);
    throw err;
  }

  // Upload chunks in writeBatches of 4 chunks (~2.8 MB per batch, well below Firestore's 10 MiB cap)
  // with 2 concurrent batch workers and automatic per-chunk fallback retry for cellular resilience.
  const BATCH_CHUNK_COUNT = 4;
  const batchRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < totalChunks; i += BATCH_CHUNK_COUNT) {
    batchRanges.push({ start: i, end: Math.min(i + BATCH_CHUNK_COUNT, totalChunks) });
  }

  let uploadedChunks = 0;
  let nextRangeIndex = 0;

  const getChunkBase64At = (idx: number): string => {
    if (canStreamNativeFile && nativeFileId) {
      const byteStart = idx * CHUNK_RAW_BYTES;
      const byteLen = Math.min(CHUNK_RAW_BYTES, totalBytes - byteStart);
      const b64 = nativeBridge.getSharedFileChunkBase64(nativeFileId, byteStart, byteLen);
      if (!b64 || typeof b64 !== 'string') {
        throw new Error(`Unable to read shared file chunk ${idx + 1}/${totalChunks}. Please share the video again.`);
      }
      return b64;
    }
    const chunkBytes = preReadChunks![idx];
    if (!chunkBytes || chunkBytes.byteLength === 0) {
      throw new Error(`Missing media chunk data at part ${idx + 1}/${totalChunks}.`);
    }
    return arrayBufferToBase64(chunkBytes);
  };

  const uploadSingleRange = async (start: number, end: number) => {
    const chunkPayloads: Array<{ index: number; docId: string; base64: string }> = [];
    for (let idx = start; idx < end; idx++) {
      chunkPayloads.push({
        index: idx,
        docId: padChunkIndex(idx),
        base64: getChunkBase64At(idx)
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

  try {
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
  } finally {
    // Once native upload succeeds (or if native temp file was consumed), clean up only on success below
  }

  if (canStreamNativeFile && options.preparedSource) {
    releasePreparedMediaSource(options.preparedSource);
  } else if (preReadChunks) {
    // Cache locally for instant playback if memory permits (non-fatal)
    await cacheMediaBlobLocally(mediaId, preReadChunks, finalMime, safeFilename);
  }

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
    const orderedChunks: Uint8Array[] = new Array(totalChunks);

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
            orderedChunks[idx] = base64ToUint8Array(chunkData.data);
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

    const objectUrl = await cacheMediaBlobLocally(mediaId, orderedChunks, mimeType, filename);
    const cachedEntry = memoryObjectUrlCache.get(mediaId);
    const fullBlob = cachedEntry?.blob || new Blob(orderedChunks as BlobPart[], { type: mimeType });
    const finalUrl = objectUrl || URL.createObjectURL(fullBlob);
    onProgress?.(100);

    return {
      objectUrl: finalUrl,
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

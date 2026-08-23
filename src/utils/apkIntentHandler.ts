/**
 * APK & Web Share Target Intent Handler for Connexa
 * Handles incoming shared media (photos, videos, text) from Android native share sheet,
 * Web Share Target API, or file drag-and-drop.
 */

import { SharedMediaItem } from '../components/ShareMediaModal';
import { compressImage } from './imageUtils';
import { processVideoFile } from './mediaUtils';

export interface PendingSharePayload {
  items: SharedMediaItem[];
  text?: string;
  source?: 'android-share-sheet' | 'web-share-target' | 'file-drop';
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
 * Initialize listeners for Web Share Target (ServiceWorker postMessage or URL query params)
 */
export function initShareTargetListener() {
  if (typeof window === 'undefined') return;

  // 1. Listen for Service Worker postMessage (Web Share Target / PWA / Android TWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data?.type === 'WEB_SHARE_TARGET_MEDIA') {
        const { files, text } = event.data;
        if (files && files.length > 0) {
          const items = await processIncomingFilesForSharing(files);
          if (items.length > 0 || text) {
            notifyShareIntent({
              items,
              text,
              source: 'web-share-target'
            });
          }
        }
      }
    });
  }

  // 2. Listen for custom Capacitor appUrlOpen or Android Intent message if dispatched
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
}

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
 * Initialize listeners for Web Share Target (ServiceWorker postMessage or URL query params)
 */
export function initShareTargetListener() {
  if (typeof window === 'undefined') return;

  // 1. Check URL query parameters (triggered by Web Share Target GET or Service Worker 303 Redirect)
  try {
    const params = new URLSearchParams(window.location.search);
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
        // Clean URL to prevent re-opening on manual page refresh
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('shared_url');
        cleanUrl.searchParams.delete('url');
        cleanUrl.searchParams.delete('link');
        cleanUrl.searchParams.delete('shared_text');
        cleanUrl.searchParams.delete('text');
        cleanUrl.searchParams.delete('shared_title');
        cleanUrl.searchParams.delete('title');
        window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.searchParams.toString() ? '?' + cleanUrl.searchParams.toString() : ''));

        notifyLinkShareIntent({
          url: finalUrl,
          title: sharedTitle || undefined,
          text: finalText || undefined,
          source: 'query-param'
        });
      }
    }
  } catch (err) {
    console.warn('Error reading share target search params:', err);
  }

  // 2. Listen for Service Worker postMessage (Web Share Target / PWA / Android TWA)
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
      } else if (event.data?.type === 'WEB_SHARE_TARGET_LINK') {
        let { url, text, title } = event.data;
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
        }
      }
    });
  }

  // 3. Listen for custom Capacitor appUrlOpen or Android Intent message if dispatched
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

  // 4. Listen for custom link share event
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

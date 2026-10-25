// Comprehensive media utility for audio voice notes, images, and video processing (up to 55MB)

import {
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_SIZE_MB,
  PreparedMediaSource,
  prepareFileForUpload,
  isChunkedMediaUrl,
  resolveChunkedMediaToObjectUrl
} from '../services/mediaStorageService';

export { MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_MB };
export type { PreparedMediaSource };

export interface VideoMetadata {
  dataUrl: string;
  file?: File | Blob;
  preparedSource?: PreparedMediaSource;
  mimeType?: string;
  filename?: string;
  thumbnailUrl: string;
  duration: number;
  size: number;
  width: number;
  height: number;
}

export function isSupportedVideoFile(file: File | Blob, filename?: string): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = (filename || (file instanceof File ? file.name : '') || '').toLowerCase();
  return /\.(mp4|webm|mov|mkv|avi|3gp|m4v|mpeg|mpg)$/i.test(name);
}

/**
 * Requests and verifies microphone permission
 */
export const requestMicrophonePermission = async (): Promise<{ granted: boolean; error?: string }> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, error: 'MediaDevices API not supported on this browser.' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true };
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return {
        granted: false,
        error: 'Microphone permission was denied. Please allow microphone access in your browser or device settings.'
      };
    }
    return { granted: false, error: err?.message || 'Failed to obtain microphone permission.' };
  }
};

/**
 * Requests and verifies camera permission
 */
export const requestCameraPermission = async (): Promise<{ granted: boolean; error?: string }> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, error: 'MediaDevices API not supported on this browser.' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true };
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return {
        granted: false,
        error: 'Camera permission was denied. Please allow camera access in your browser or device settings.'
      };
    }
    return { granted: false, error: err?.message || 'Failed to obtain camera permission.' };
  }
};

/**
 * Extract a poster thumbnail and duration from a video file using streaming ObjectURL
 * (with fallback timeout so large/exotic containers up to 55MB never hang or throw)
 */
export const generateVideoThumbnail = (
  videoFile: File | Blob
): Promise<{ thumbnail: string; duration: number; width: number; height: number }> => {
  return new Promise((resolve) => {
    let settled = false;
    let url = '';
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    try {
      url = URL.createObjectURL(videoFile);
    } catch {
      resolve({ thumbnail: '', duration: 0, width: 480, height: 270 });
      return;
    }

    const finalize = (result: { thumbnail: string; duration: number; width: number; height: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        // ignore
      }
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const safetyTimer = setTimeout(() => {
      const dur = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      finalize({
        thumbnail: '',
        duration: dur,
        width: video.videoWidth || 480,
        height: video.videoHeight || 270
      });
    }, 6500);

    video.onloadedmetadata = () => {
      const validDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const seekTime = validDuration > 0 ? Math.min(1, Math.max(0.1, validDuration * 0.1)) : 0.1;
      try {
        video.currentTime = seekTime;
      } catch {
        finalize({
          thumbnail: '',
          duration: Math.round(validDuration),
          width: video.videoWidth || 480,
          height: video.videoHeight || 270
        });
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(480, video.videoWidth || 480);
        const ratio = (video.videoHeight || 270) / (video.videoWidth || 480);
        const targetHeight = Math.max(1, Math.round(targetWidth * ratio));

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        const safeDuration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
        if (!ctx) {
          finalize({
            thumbnail: '',
            duration: safeDuration,
            width: video.videoWidth || targetWidth,
            height: video.videoHeight || targetHeight
          });
          return;
        }

        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.75);

        finalize({
          thumbnail,
          duration: safeDuration,
          width: video.videoWidth || targetWidth,
          height: video.videoHeight || targetHeight
        });
      } catch {
        const safeDuration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
        finalize({
          thumbnail: '',
          duration: safeDuration,
          width: 480,
          height: 270
        });
      }
    };

    video.onerror = () => {
      finalize({
        thumbnail: '',
        duration: 0,
        width: 480,
        height: 270
      });
    };

    video.src = url;
  });
};

/**
 * Process and validate a video file up to 55MB for chat or external sharing.
 * Immediately snapshots 528 KB binary chunks while the Android/browser File handle is fresh,
 * preventing NotReadableError ("uploaded file is unable to read") and BlobRegistry exhaustion.
 */
export const processVideoFile = async (
  file: File,
  maxSizeBytes = MAX_VIDEO_SIZE_BYTES,
  onReadProgress?: (percent: number) => void
): Promise<VideoMetadata> => {
  if (!isSupportedVideoFile(file, file.name)) {
    throw new Error('Please select a valid video file (MP4, WebM, MOV, MKV, 3GP).');
  }

  if (file.size > maxSizeBytes) {
    const limitMb = Math.round(maxSizeBytes / (1024 * 1024));
    throw new Error(
      `Video file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum supported video size is ${limitMb}MB.`
    );
  }

  const resolvedMime = file.type || 'video/mp4';
  const filename = file.name || 'video.mp4';

  // 1. Read file into 528 KB Uint8Array chunks FIRST while OS/Android content:// descriptor is fresh
  const preparedSource = await prepareFileForUpload(file, filename, resolvedMime, onReadProgress);

  // 2. Extract poster thumbnail & duration (non-blocking fallback if OS closed original stream after read)
  let thumbInfo = await generateVideoThumbnail(file);
  if (!thumbInfo.thumbnail && preparedSource.chunks && preparedSource.size <= 30 * 1024 * 1024) {
    try {
      const tempBlob = new Blob(preparedSource.chunks as BlobPart[], { type: resolvedMime });
      thumbInfo = await generateVideoThumbnail(tempBlob);
    } catch {
      // ignore fallback thumbnail failure
    }
  }

  return {
    dataUrl: '',
    preparedSource,
    mimeType: resolvedMime,
    filename,
    thumbnailUrl: thumbInfo.thumbnail,
    duration: thumbInfo.duration,
    size: preparedSource.size,
    width: thumbInfo.width,
    height: thumbInfo.height
  };
};

/**
 * Format time in seconds to mm:ss format (e.g. 01:24)
 */
export const formatMediaDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

/**
 * Download a video or file from a chunked media reference, Blob ObjectURL, or DataURL
 */
export const downloadVideoDataUrl = async (
  mediaUrl: string,
  filename = 'connexa-video.mp4',
  onProgress?: (percent: number) => void
): Promise<void> => {
  try {
    let downloadHref = mediaUrl;
    let finalFilename = filename;

    if (isChunkedMediaUrl(mediaUrl)) {
      const resolved = await resolveChunkedMediaToObjectUrl(mediaUrl, onProgress);
      downloadHref = resolved.objectUrl;
      if (!filename && resolved.filename) {
        finalFilename = resolved.filename;
      }
    }

    const link = document.createElement('a');
    link.href = downloadHref;
    link.download = finalFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('Error downloading media:', e);
  }
};

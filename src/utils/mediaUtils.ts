// Comprehensive media utility for audio voice notes, images, and video processing

import { compressImage } from './imageUtils';

export interface VideoMetadata {
  dataUrl: string;
  thumbnailUrl: string;
  duration: number;
  size: number;
  width: number;
  height: number;
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
    // Stop immediately after checking/granting
    stream.getTracks().forEach(t => t.stop());
    return { granted: true };
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { granted: false, error: 'Microphone permission was denied. Please allow microphone access in your browser or device settings.' };
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
    stream.getTracks().forEach(t => t.stop());
    return { granted: true };
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { granted: false, error: 'Camera permission was denied. Please allow camera access in your browser or device settings.' };
    }
    return { granted: false, error: err?.message || 'Failed to obtain camera permission.' };
  }
};

/**
 * Extract a poster thumbnail from a video file
 */
export const generateVideoThumbnail = (videoFile: File | Blob): Promise<{ thumbnail: string; duration: number; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.onloadedmetadata = () => {
      // Seek to 0.5s or 10% of video
      const seekTime = Math.min(1, Math.max(0.1, video.duration * 0.1));
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(480, video.videoWidth || 480);
        const ratio = (video.videoHeight || 360) / (video.videoWidth || 480);
        const targetHeight = Math.round(targetWidth * ratio);

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve({ thumbnail: '', duration: Math.round(video.duration || 0), width: video.videoWidth, height: video.videoHeight });
          return;
        }

        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.75);
        const duration = Math.round(video.duration || 0);

        URL.revokeObjectURL(url);
        resolve({
          thumbnail,
          duration,
          width: video.videoWidth,
          height: video.videoHeight
        });
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve({ thumbnail: '', duration: Math.round(video.duration || 0), width: 320, height: 240 });
      }
    };

    video.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video for processing.'));
    };
  });
};

/**
 * Process and convert a video file into a safe, transportable format for chat
 */
export const processVideoFile = async (
  file: File, 
  maxSizeBytes = 12 * 1024 * 1024
): Promise<VideoMetadata> => {
  if (!file.type.startsWith('video/')) {
    throw new Error('Please select a valid video file (MP4, WebM, MOV).');
  }

  if (file.size > maxSizeBytes) {
    throw new Error(`Video file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please select a short clip under 12MB.`);
  }

  const { thumbnail, duration, width, height } = await generateVideoThumbnail(file);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve({
          dataUrl: reader.result,
          thumbnailUrl: thumbnail,
          duration,
          size: file.size,
          width,
          height
        });
      } else {
        reject(new Error('Failed to encode video data.'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading video file.'));
    reader.readAsDataURL(file);
  });
};

/**
 * Format time in seconds to mm:ss format (e.g. 01:24)
 */
export const formatMediaDuration = (seconds: number): string => {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

/**
 * Download a video data URL
 */
export const downloadVideoDataUrl = (dataUrl: string, filename = 'connexa-video.mp4') => {
  try {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('Error downloading video:', e);
    window.open(dataUrl, '_blank');
  }
};

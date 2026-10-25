import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Maximize2,
  Download,
  Volume2,
  VolumeX,
  AlertCircle,
  Loader2,
  Film
} from 'lucide-react';
import { downloadVideoDataUrl, formatMediaDuration } from '../utils/mediaUtils';
import {
  isChunkedMediaUrl,
  peekCachedMediaObjectUrl,
  getCachedMediaEntry,
  resolveChunkedMediaToObjectUrl
} from '../services/mediaStorageService';

interface VideoPlayerMessageProps {
  mediaUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  mediaSize?: number;
  filename?: string;
  onOpenFullscreen: (url: string) => void;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const VideoPlayerMessage: React.FC<VideoPlayerMessageProps> = ({
  mediaUrl,
  thumbnailUrl,
  duration = 0,
  mediaSize,
  filename,
  onOpenFullscreen
}) => {
  const isChunked = isChunkedMediaUrl(mediaUrl);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => {
    if (!isChunked) return mediaUrl;
    return peekCachedMediaObjectUrl(mediaUrl);
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration);
  const [hasError, setHasError] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingAutoPlayRef = useRef(false);

  // Restore cached Blob URL automatically if already downloaded on this device (or auto-prefetch small clips <= 4MB)
  useEffect(() => {
    let cancelled = false;
    setHasError(false);
    setDownloadError(null);

    if (!isChunkedMediaUrl(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      return;
    }

    const memUrl = peekCachedMediaObjectUrl(mediaUrl);
    if (memUrl) {
      setResolvedUrl(memUrl);
      return;
    }

    (async () => {
      const cached = await getCachedMediaEntry(mediaUrl);
      if (cancelled) return;
      if (cached) {
        setResolvedUrl(cached.objectUrl);
        return;
      }
      // Auto-prefetch clips <= 4 MB in the background; larger clips up to 55 MB stream on demand when tapped
      if (mediaSize && mediaSize > 0 && mediaSize <= 4 * 1024 * 1024) {
        try {
          setIsDownloading(true);
          const result = await resolveChunkedMediaToObjectUrl(mediaUrl, (pct) => {
            if (!cancelled) setDownloadProgress(pct);
          });
          if (!cancelled) {
            setResolvedUrl(result.objectUrl);
          }
        } catch {
          // User can retry by tapping play
        } finally {
          if (!cancelled) setIsDownloading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaUrl, mediaSize]);

  // Trigger autoplay once resolvedUrl finishes downloading from a Play tap
  useEffect(() => {
    if (resolvedUrl && pendingAutoPlayRef.current && videoRef.current) {
      pendingAutoPlayRef.current = false;
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.warn('Autoplay after download warning:', err);
        });
    }
  }, [resolvedUrl]);

  const ensureResolvedUrl = async (): Promise<string | null> => {
    if (resolvedUrl) return resolvedUrl;
    if (!isChunkedMediaUrl(mediaUrl)) return mediaUrl;
    if (isDownloading) return null;

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress(2);

    try {
      const result = await resolveChunkedMediaToObjectUrl(mediaUrl, (pct) => {
        setDownloadProgress(pct);
      });
      setResolvedUrl(result.objectUrl);
      return result.objectUrl;
    } catch (err: any) {
      console.error('Error loading video:', err);
      setDownloadError('Tap to retry loading video');
      return null;
    } finally {
      setIsDownloading(false);
    }
  };

  const togglePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!resolvedUrl) {
      pendingAutoPlayRef.current = true;
      await ensureResolvedUrl();
      return;
    }

    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.warn('Playback error:', err);
        });
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleOpenFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = await ensureResolvedUrl();
    if (url) {
      if (videoRef.current && isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
      onOpenFullscreen(url);
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = await ensureResolvedUrl();
    if (url) {
      await downloadVideoDataUrl(url, filename || `connexa-video-${Date.now()}.mp4`);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current && (!duration || duration === 0) && Number.isFinite(videoRef.current.duration)) {
      setVideoDuration(Math.round(videoRef.current.duration));
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  if (hasError) {
    return (
      <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 text-xs text-slate-500 max-w-xs">
        <div className="flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <span>Video format cannot play inline on this device.</span>
        </div>
        {resolvedUrl && (
          <button
            type="button"
            onClick={handleDownload}
            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shrink-0 cursor-pointer"
            title="Download video"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  const sizeLabel = formatFileSize(mediaSize);

  return (
    <div className="relative group/video rounded-2xl overflow-hidden w-64 sm:w-72 bg-slate-950 border border-slate-200/40 dark:border-slate-700/60 shadow-xs">
      {resolvedUrl ? (
        <video
          ref={videoRef}
          src={resolvedUrl}
          poster={thumbnailUrl || undefined}
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onError={() => setHasError(true)}
          onClick={togglePlay}
          className="w-full max-h-72 min-h-[160px] object-cover cursor-pointer rounded-2xl bg-black"
        />
      ) : (
        <div
          onClick={togglePlay}
          className="w-full h-48 relative flex items-center justify-center bg-slate-900 cursor-pointer select-none"
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Video preview"
              className="w-full h-full object-cover opacity-85"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-slate-400">
              <Film className="w-8 h-8 opacity-60" />
              <span className="text-[11px] font-medium">Video Clip</span>
            </div>
          )}
        </div>
      )}

      {/* Top-right Size Badge when paused */}
      {!isPlaying && sizeLabel && (
        <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-xs text-[10px] font-semibold text-white pointer-events-none">
          {sizeLabel}
        </div>
      )}

      {/* Center Play / Downloading Progress Overlay */}
      {!isPlaying && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 bg-black/35 flex flex-col items-center justify-center gap-2 cursor-pointer transition-opacity group-hover/video:bg-black/45"
        >
          {isDownloading ? (
            <div className="px-4 py-2.5 bg-black/75 backdrop-blur-md rounded-2xl flex flex-col items-center gap-1.5 text-white shadow-xl border border-white/10">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span className="text-[11px] font-semibold">
                Loading {downloadProgress}%
              </span>
            </div>
          ) : (
            <>
              <div className="p-3.5 bg-blue-600/90 hover:bg-blue-600 text-white rounded-full shadow-lg transform transition-transform group-hover/video:scale-110">
                <Play className="w-6 h-6 fill-white" />
              </div>
              {downloadError && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-600/90 text-white text-[10px] font-semibold">
                  {downloadError}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Bottom Control Bar Overlay */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 flex items-center justify-between text-white text-xs transition-opacity duration-200 ${
          isPlaying ? 'opacity-0 group-hover/video:opacity-100' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={isDownloading}
            className="p-1 hover:text-blue-400 transition-colors cursor-pointer disabled:opacity-50"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
          </button>

          <span className="text-[10px] font-mono opacity-90">
            {formatMediaDuration(currentTime)} / {formatMediaDuration(videoDuration)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {resolvedUrl && (
            <button
              type="button"
              onClick={toggleMute}
              className="p-1 hover:text-blue-400 transition-colors cursor-pointer"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenFullscreen}
            disabled={isDownloading}
            className="p-1 hover:text-blue-400 transition-colors cursor-pointer disabled:opacity-50"
            title="Fullscreen Video"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="p-1 hover:text-blue-400 transition-colors cursor-pointer disabled:opacity-50"
            title="Download Video"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

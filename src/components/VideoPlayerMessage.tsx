import React, { useState, useRef } from 'react';
import { Play, Pause, Maximize2, Download, Video as VideoIcon, Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { downloadVideoDataUrl, formatMediaDuration } from '../utils/mediaUtils';

interface VideoPlayerMessageProps {
  mediaUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  onOpenFullscreen: (url: string) => void;
}

export const VideoPlayerMessage: React.FC<VideoPlayerMessageProps> = ({
  mediaUrl,
  thumbnailUrl,
  duration = 0,
  onOpenFullscreen
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration);
  const [hasError, setHasError] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
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

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current && (!duration || duration === 0)) {
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
      <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 text-xs text-slate-500">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
        <span>Video format not supported on this device.</span>
      </div>
    );
  }

  return (
    <div className="relative group/video rounded-2xl overflow-hidden max-w-xs sm:max-w-sm bg-black border border-slate-200/40 dark:border-slate-700/60 shadow-xs">
      <video
        ref={videoRef}
        src={mediaUrl}
        poster={thumbnailUrl}
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={() => setHasError(true)}
        onClick={togglePlay}
        className="w-full max-h-72 object-cover cursor-pointer rounded-2xl"
      />

      {/* Center Play Button Overlay when paused */}
      {!isPlaying && (
        <div 
          onClick={togglePlay}
          className="absolute inset-0 bg-black/35 flex items-center justify-center cursor-pointer transition-opacity group-hover/video:bg-black/45"
        >
          <div className="p-3.5 bg-blue-600/90 hover:bg-blue-600 text-white rounded-full shadow-lg transform transition-transform group-hover/video:scale-110">
            <Play className="w-6 h-6 fill-white" />
          </div>
        </div>
      )}

      {/* Control Bar Overlay */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5 flex items-center justify-between text-white text-xs transition-opacity duration-200 ${
          isPlaying ? 'opacity-0 group-hover/video:opacity-100' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="p-1 hover:text-blue-400 transition-colors"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
          </button>

          <span className="text-[10px] font-mono opacity-90">
            {formatMediaDuration(currentTime)} / {formatMediaDuration(videoDuration)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1 hover:text-blue-400 transition-colors"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => onOpenFullscreen(mediaUrl)}
            className="p-1 hover:text-blue-400 transition-colors"
            title="Fullscreen Video"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => downloadVideoDataUrl(mediaUrl, `connexa-video-${Date.now()}.mp4`)}
            className="p-1 hover:text-blue-400 transition-colors"
            title="Download Video"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

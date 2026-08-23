import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Mic, Volume2 } from 'lucide-react';
import { formatMediaDuration } from '../utils/mediaUtils';

interface AudioVoiceMessageProps {
  mediaUrl: string;
  isMe: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export const AudioVoiceMessage: React.FC<AudioVoiceMessageProps> = ({
  mediaUrl,
  isMe,
  isPlaying,
  onTogglePlay
}) => {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(mediaUrl);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(Math.round(audio.duration));
      }
    };

    audio.ontimeupdate = () => {
      setCurrentTime(Math.round(audio.currentTime));
    };

    audio.onended = () => {
      if (isPlaying) {
        onTogglePlay();
      }
      setCurrentTime(0);
    };

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [mediaUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(e => console.warn('Audio play error:', e));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Pseudorandom pseudo-waveform bars for aesthetic audio visualization
  const bars = [40, 70, 30, 85, 60, 95, 45, 80, 55, 90, 35, 75, 50, 65, 85, 40];

  return (
    <div 
      onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
      className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer min-w-[200px] sm:min-w-[240px] transition-all select-none ${
        isMe 
          ? 'bg-blue-700/80 hover:bg-blue-700 text-white' 
          : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/70 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100'
      }`}
    >
      <button
        type="button"
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-md transition-transform transform active:scale-95 ${
          isMe ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 space-y-1 min-w-0">
        {/* Animated Waveform Bars */}
        <div className="flex items-center gap-1 h-5 overflow-hidden">
          {bars.map((heightPercent, idx) => {
            const isPlayed = duration > 0 && (idx / bars.length) <= (currentTime / duration);
            return (
              <div
                key={idx}
                style={{ height: `${heightPercent}%` }}
                className={`w-1 rounded-full transition-all duration-150 ${
                  isPlayed 
                    ? (isMe ? 'bg-white' : 'bg-blue-600 dark:bg-blue-400')
                    : (isMe ? 'bg-blue-300/60' : 'bg-slate-300 dark:bg-slate-600')
                } ${isPlaying && isPlayed ? 'animate-pulse' : ''}`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono opacity-80">
          <span>Voice Note</span>
          <span>{formatMediaDuration(isPlaying ? currentTime : duration)}</span>
        </div>
      </div>
    </div>
  );
};

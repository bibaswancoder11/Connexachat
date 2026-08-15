import React, { useState, useEffect } from 'react';
import { X, Download, ZoomIn, ZoomOut, User, Users, ShieldCheck, Clock, ExternalLink } from 'lucide-react';
import { UserProfile } from '../types';
import { isUserOnline, formatLastSeen } from '../services/userService';
import { downloadImageDataUrl } from '../utils/imageUtils';

export interface AvatarPreviewData {
  photoURL: string;
  name: string;
  subtitle?: string;
  bio?: string;
  userProfile?: UserProfile;
  isGroup?: boolean;
  memberCount?: number;
}

interface AvatarPreviewModalProps {
  data: AvatarPreviewData | null;
  onClose: () => void;
  onOpenDirectChat?: (uid: string) => void;
}

export const AvatarPreviewModal: React.FC<AvatarPreviewModalProps> = ({
  data,
  onClose,
  onOpenDirectChat
}) => {
  const [zoom, setZoom] = useState(1);

  // Reset zoom whenever image changes
  useEffect(() => {
    setZoom(1);
  }, [data?.photoURL]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (data) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, onClose]);

  if (!data) return null;

  const online = data.userProfile ? isUserOnline(data.userProfile) : false;
  const lastSeenText = data.userProfile ? formatLastSeen(data.userProfile.lastSeen) : '';

  const handleDownload = () => {
    const filename = `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_avatar.png`;
    downloadImageDataUrl(data.photoURL, filename);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      {/* Top Controls Bar */}
      <div
        className="w-full max-w-2xl mx-auto flex items-center justify-between bg-slate-900/90 border border-white/10 backdrop-blur-md px-4 py-3 rounded-2xl text-white shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl">
            {data.isGroup ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">{data.name}</h3>
            <p className="text-[11px] text-slate-400 truncate">
              {data.isGroup
                ? `${data.memberCount || 'Group'} members`
                : data.subtitle || (data.userProfile ? `@${data.userProfile.username}${data.userProfile.userTag || ''}` : 'User Profile Picture')}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-400 min-w-[36px] text-center hidden sm:inline">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(z => Math.min(3, z + 0.25))}
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-2 text-blue-400 hover:text-blue-300 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold"
            title="Download Avatar"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Save</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-white/10 transition-colors ml-1"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Center Enlarged Avatar Image */}
      <div
        className="flex-1 flex flex-col items-center justify-center overflow-auto p-4 my-auto cursor-default"
        onClick={onClose}
      >
        <div
          className="relative max-w-sm sm:max-w-md w-full flex flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Avatar Container with glowing border and shadow */}
          <div className="relative group">
            <div className="w-64 h-64 sm:w-80 sm:h-80 rounded-3xl overflow-hidden bg-slate-900 border-4 border-slate-700/80 shadow-2xl ring-4 ring-blue-500/20 flex items-center justify-center">
              <img
                src={data.photoURL}
                alt={data.name}
                style={{ transform: `scale(${zoom})` }}
                className="w-full h-full object-cover transition-transform duration-200 cursor-zoom-in"
                onDoubleClick={() => setZoom(z => z === 1 ? 1.75 : 1)}
              />
            </div>

            {/* Status indicator badge */}
            {data.userProfile && (
              <span
                className={`absolute bottom-3 right-3 w-6 h-6 rounded-full ring-4 ring-slate-900 transition-colors flex items-center justify-center ${
                  online ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-slate-500'
                }`}
                title={online ? 'Online' : 'Offline'}
              >
                {online && <span className="w-2 h-2 rounded-full bg-white animate-ping" />}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Profile Details Card */}
      <div
        className="w-full max-w-2xl mx-auto bg-slate-900/90 border border-white/10 backdrop-blur-md p-4 sm:p-5 rounded-2xl text-white shadow-2xl z-10 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-white">{data.name}</h4>
              {data.userProfile?.userTag && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-medium border border-blue-500/30">
                  {data.userProfile.userTag}
                </span>
              )}
            </div>
            {data.userProfile?.username && (
              <p className="text-xs text-slate-400 font-mono">@{data.userProfile.username}</p>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            {data.userProfile && (
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    online ? 'bg-emerald-500' : 'bg-slate-500'
                  }`}
                />
                <span className={online ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {online ? 'Online now' : (lastSeenText ? `Last seen ${lastSeenText}` : 'Offline')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bio if available */}
        {data.bio ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-slate-200 leading-relaxed">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              About / Bio
            </span>
            <p className="italic">"{data.bio}"</p>
          </div>
        ) : data.userProfile?.bio ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-slate-200 leading-relaxed">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              About / Bio
            </span>
            <p className="italic">"{data.userProfile.bio}"</p>
          </div>
        ) : null}

        {/* Action Row */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-slate-400">
            Double-click photo to toggle zoom • Click outside or press Esc to close
          </p>
          {data.userProfile && onOpenDirectChat && (
            <button
              type="button"
              onClick={() => {
                if (data.userProfile) {
                  onOpenDirectChat(data.userProfile.uid);
                  onClose();
                }
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-xs"
            >
              Message
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

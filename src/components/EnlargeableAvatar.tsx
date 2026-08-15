import React from 'react';
import { useAvatarPreview } from '../context/AvatarPreviewContext';
import { UserProfile } from '../types';
import { isUserOnline } from '../services/userService';
import { Users2, ZoomIn } from 'lucide-react';

interface EnlargeableAvatarProps {
  src: string;
  alt: string;
  name?: string;
  userProfile?: UserProfile;
  subtitle?: string;
  bio?: string;
  isGroup?: boolean;
  memberCount?: number;
  sizeClass?: string;
  className?: string;
  showStatusBadge?: boolean;
  showGroupBadge?: boolean;
  enableEnlarge?: boolean;
  statusOverride?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export const EnlargeableAvatar: React.FC<EnlargeableAvatarProps> = ({
  src,
  alt,
  name,
  userProfile,
  subtitle,
  bio,
  isGroup = false,
  memberCount,
  sizeClass = 'w-12 h-12 rounded-2xl',
  className = '',
  showStatusBadge = false,
  showGroupBadge = false,
  enableEnlarge = true,
  statusOverride,
  onClick
}) => {
  const { openAvatarPreview } = useAvatarPreview();

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
    if (enableEnlarge) {
      e.stopPropagation();
      e.preventDefault();
      openAvatarPreview({
        photoURL: src,
        name: name || userProfile?.displayName || alt,
        subtitle: subtitle || (userProfile ? `@${userProfile.username}${userProfile.userTag || ''}` : undefined),
        bio: bio || userProfile?.bio,
        userProfile: userProfile,
        isGroup: isGroup,
        memberCount: memberCount
      });
    }
  };

  const isOnline = statusOverride !== undefined
    ? statusOverride
    : (userProfile ? isUserOnline(userProfile) : false);

  return (
    <div
      onClick={handleClick}
      className={`relative shrink-0 select-none ${enableEnlarge ? 'cursor-pointer group/avatar' : ''} ${className}`}
      title={enableEnlarge ? `Click to view ${name || alt}'s enlarged photo` : alt}
    >
      <div className={`relative overflow-hidden ${sizeClass} bg-blue-50 dark:bg-slate-800 ring-2 ring-slate-100 dark:ring-slate-800 transition-all ${enableEnlarge ? 'group-hover/avatar:ring-blue-500/60 group-hover/avatar:scale-105 group-hover/avatar:shadow-md' : ''}`}>
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover transition-transform duration-200"
          onError={(e) => {
            // Fallback to DiceBear if image URL is broken
            (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(alt || 'user')}`;
          }}
        />

        {/* Subtle Hover Zoom Overlay */}
        {enableEnlarge && (
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <ZoomIn className="w-4 h-4 text-white drop-shadow-xs" />
          </div>
        )}
      </div>

      {/* Online / Offline Status Badge */}
      {showStatusBadge && !isGroup && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-slate-900 transition-colors ${
            isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
          }`}
          title={isOnline ? 'Online' : 'Offline'}
        />
      )}

      {/* Group Member Count Badge */}
      {showGroupBadge && isGroup && memberCount !== undefined && (
        <span className="absolute -bottom-1 -right-1 px-1 py-0.5 bg-blue-600 text-white text-[9px] font-bold rounded-md ring-2 ring-white dark:ring-slate-900 flex items-center gap-0.5 pointer-events-none">
          <Users2 className="w-2.5 h-2.5" />
          {memberCount}
        </span>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { X, Download, ZoomIn, ZoomOut, User, Users, ShieldCheck, Lock, UserPlus, Clock, Inbox, MessageSquare } from 'lucide-react';
import { FriendRequest, UserProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { isUserOnline, formatLastSeen } from '../services/userService';
import { downloadImageDataUrl } from '../utils/imageUtils';

export interface AvatarPreviewData {
  photoURL: string;
  name: string;
  uid?: string;
  subtitle?: string;
  bio?: string;
  userProfile?: UserProfile;
  isGroup?: boolean;
  memberCount?: number;
}

interface AvatarPreviewModalProps {
  data: AvatarPreviewData | null;
  friends?: UserProfile[];
  incomingRequests?: FriendRequest[];
  outgoingRequests?: FriendRequest[];
  onClose: () => void;
  onOpenDirectChat?: (uid: string) => void;
  onSendFriendRequest?: (targetUser: UserProfile) => Promise<void>;
  onNavigateToRequests?: () => void;
}

export const AvatarPreviewModal: React.FC<AvatarPreviewModalProps> = ({
  data,
  friends = [],
  incomingRequests = [],
  outgoingRequests = [],
  onClose,
  onOpenDirectChat,
  onSendFriendRequest,
  onNavigateToRequests
}) => {
  const { currentUser } = useAuth();
  const [zoom, setZoom] = useState(1);
  const [sendingRequest, setSendingRequest] = useState(false);

  // Reset zoom and request state whenever modal target changes
  useEffect(() => {
    setZoom(1);
    setSendingRequest(false);
  }, [data?.photoURL, data?.uid, data?.userProfile?.uid]);

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

  const targetUid = data.uid || data.userProfile?.uid;

  // Determine if the viewed avatar is the current user's own profile photo
  const isOwnProfile = Boolean(
    currentUser && targetUid && targetUid === currentUser.uid
  );

  // Strict friendship verification: Only accepted friends can be messaged!
  const isFriend = Boolean(
    !data.isGroup && !isOwnProfile && targetUid && friends.some(f => f.uid === targetUid)
  );

  const isPendingSent = Boolean(
    !data.isGroup && !isOwnProfile && targetUid && outgoingRequests.some(r => r.toUid === targetUid && r.status === 'pending')
  );

  const isPendingReceived = Boolean(
    !data.isGroup && !isOwnProfile && targetUid && incomingRequests.some(r => r.fromUid === targetUid && r.status === 'pending')
  );

  const online = data.userProfile && (isFriend || isOwnProfile) ? isUserOnline(data.userProfile) : false;
  const lastSeenText = data.userProfile && (isFriend || isOwnProfile) ? formatLastSeen(data.userProfile) : '';

  const handleDownload = () => {
    if (!isOwnProfile) return; // Strict safeguard: Only allow downloading your own profile photo
    const filename = `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_avatar.png`;
    downloadImageDataUrl(data.photoURL, filename);
  };

  const handleAddFriendClick = async () => {
    if (!data.userProfile || !onSendFriendRequest || sendingRequest) return;
    setSendingRequest(true);
    try {
      await onSendFriendRequest(data.userProfile);
    } catch (err) {
      console.error('Error sending friend request from preview:', err);
    } finally {
      setSendingRequest(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-200 select-none"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
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
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
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
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {/* Download button only allowed for the user's own profile photo */}
          {isOwnProfile ? (
            <button
              type="button"
              onClick={handleDownload}
              className="p-2 text-blue-400 hover:text-blue-300 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              title="Download Your Profile Photo"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Save</span>
            </button>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-medium cursor-help"
              title="Profile photo is protected. Downloads and saving of other users' photos are disabled for privacy."
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Protected</span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-white/10 transition-colors ml-1 cursor-pointer"
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
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="relative max-w-sm sm:max-w-md w-full flex flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Avatar Container with glowing border and shadow */}
          <div className="relative group select-none">
            <div
              className="w-64 h-64 sm:w-80 sm:h-80 rounded-3xl overflow-hidden bg-slate-900 border-4 border-slate-700/80 shadow-2xl ring-4 ring-blue-500/20 flex items-center justify-center relative"
              onContextMenu={(e) => e.preventDefault()}
            >
              <img
                src={data.photoURL}
                alt={data.name}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
                style={{ transform: `scale(${zoom})` }}
                className="w-full h-full object-cover transition-transform duration-200 cursor-zoom-in pointer-events-auto select-none"
                onDoubleClick={() => setZoom(z => z === 1 ? 1.75 : 1)}
              />

              {/* Privacy Badge overlay for other users */}
              {!isOwnProfile && (
                <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] text-slate-300 flex items-center gap-1.5 pointer-events-none border border-white/10 shadow-sm">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span className="font-medium tracking-wide">Privacy Protected</span>
                </div>
              )}
            </div>

            {/* Status indicator badge (shown only for own profile or accepted friends) */}
            {data.userProfile && (isFriend || isOwnProfile) && (
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
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-bold text-white">{data.name}</h4>
              {data.userProfile?.userTag && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-medium border border-blue-500/30">
                  {data.userProfile.userTag}
                </span>
              )}
              {isFriend && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3" /> Friend
                </span>
              )}
            </div>
            {data.userProfile?.username && (
              <p className="text-xs text-slate-400 font-mono">@{data.userProfile.username}</p>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            {data.userProfile && (isFriend || isOwnProfile) && (
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

        {/* Action Row: Strictly enforce friend-only messaging */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            {!isOwnProfile && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            <span>
              {!isOwnProfile
                ? (isFriend
                    ? 'Profile picture protected • Connected as friends'
                    : 'Direct messaging is restricted to accepted friends only')
                : 'Double-click photo to toggle zoom • Click outside or press Esc to close'}
            </span>
          </p>

          {!data.isGroup && !isOwnProfile && targetUid && (
            <div className="shrink-0 flex items-center justify-end">
              {isFriend && onOpenDirectChat ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenDirectChat(targetUid);
                    onClose();
                  }}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Message</span>
                </button>
              ) : isPendingSent ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5 animate-pulse" />
                  <span>Request Pending</span>
                </span>
              ) : isPendingReceived ? (
                <button
                  type="button"
                  onClick={() => {
                    onNavigateToRequests?.();
                    onClose();
                  }}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <Inbox className="w-3.5 h-3.5" />
                  <span>Respond to Request</span>
                </button>
              ) : data.userProfile && onSendFriendRequest ? (
                <button
                  type="button"
                  disabled={sendingRequest}
                  onClick={handleAddFriendClick}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-900 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{sendingRequest ? 'Sending...' : 'Add Friend'}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-slate-300 border border-white/10 rounded-xl text-xs font-medium">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Friends Only</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

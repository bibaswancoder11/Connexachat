import React, { useState, useEffect } from 'react';
import { 
  X, 
  Send, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  Check, 
  CheckSquare, 
  Square, 
  Search, 
  Loader2, 
  Users2, 
  AlertCircle,
  Plus
} from 'lucide-react';
import { UserProfile, ChatRoom } from '../types';
import { isUserBlockedLocally } from '../services/blockService';
import { getOrCreateChat, sendMessage } from '../services/chatService';
import { compressImage } from '../utils/imageUtils';
import { processVideoFile, VideoMetadata } from '../utils/mediaUtils';
import { EnlargeableAvatar } from './EnlargeableAvatar';

export interface SharedMediaItem {
  type: 'image' | 'video';
  dataUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  filename?: string;
}

interface ShareMediaModalProps {
  currentUser: UserProfile;
  friends: UserProfile[];
  chats: ChatRoom[];
  initialItems?: SharedMediaItem[];
  onClose: () => void;
  onSuccess?: (chatIds: string[]) => void;
}

export const ShareMediaModal: React.FC<ShareMediaModalProps> = ({
  currentUser,
  friends,
  chats,
  initialItems = [],
  onClose,
  onSuccess
}) => {
  const [mediaItems, setMediaItems] = useState<SharedMediaItem[]>(initialItems);
  const [caption, setCaption] = useState('');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]); // recipient UIDs (friends) or group chatIds
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setMediaItems(initialItems);
    }
  }, [initialItems]);

  // Support mobile back navigation and desktop Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Support browser history / mobile swipe-back gesture to cancel modal cleanly
    const stateId = `share-media-modal-${Date.now()}`;
    window.history.pushState({ modal: stateId }, '');
    const handlePopState = () => {
      onClose();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onClose]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Group chats available
  const groupChats = React.useMemo(() => chats.filter(c => c.isGroup), [chats]);

  // Combine direct accepted friends with any 1-on-1 chat contacts so all friends are accessible
  const availableFriends = React.useMemo(() => {
    const map = new Map<string, UserProfile>();
    friends.forEach(f => {
      if (f.uid !== currentUser.uid) {
        map.set(f.uid, f);
      }
    });
    chats.forEach(c => {
      if (!c.isGroup && c.otherUser && c.otherUser.uid !== currentUser.uid) {
        if (!map.has(c.otherUser.uid)) {
          map.set(c.otherUser.uid, c.otherUser);
        }
      }
    });
    return Array.from(map.values()).map(friend => ({
      ...friend,
      isBlocked: isUserBlockedLocally(currentUser.uid, friend.uid)
    }));
  }, [friends, chats, currentUser.uid]);

  const handleToggleRecipient = (id: string, isBlocked = false) => {
    if (isBlocked) {
      alert('This user is currently blocked on your device. Unblock them first to send media.');
      return;
    }
    setSelectedRecipientIds(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const validFriendUids = availableFriends.filter(f => !f.isBlocked).map(f => f.uid);
    const groupChatIds = groupChats.map(g => g.id);
    const allIds = [...validFriendUids, ...groupChatIds];

    if (selectedRecipientIds.length === allIds.length) {
      setSelectedRecipientIds([]);
    } else {
      setSelectedRecipientIds(allIds);
    }
  };

  const handleAddMediaFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingFiles(true);
    setStatusMessage('Processing selected media...');

    const newItems: SharedMediaItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
          newItems.push({
            type: 'image',
            dataUrl: compressed,
            filename: file.name
          });
        } else if (file.type.startsWith('video/')) {
          const meta = await processVideoFile(file);
          newItems.push({
            type: 'video',
            dataUrl: meta.dataUrl,
            thumbnailUrl: meta.thumbnailUrl,
            duration: meta.duration,
            filename: file.name
          });
        }
      } catch (err: any) {
        alert(err.message || `Failed to process ${file.name}`);
      }
    }

    setMediaItems(prev => [...prev, ...newItems]);
    setIsProcessingFiles(false);
    setStatusMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveMedia = (index: number) => {
    setMediaItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSendToRecipients = async (targetRecipientIds: string[]) => {
    if (targetRecipientIds.length === 0) {
      alert('Please select at least one friend or group to share with.');
      return;
    }

    if (mediaItems.length === 0 && !caption.trim()) {
      alert('Please add a photo, video, or message caption.');
      return;
    }

    setIsSending(true);
    setStatusMessage(`Sending media to ${targetRecipientIds.length} conversation(s)...`);

    const affectedChatIds: string[] = [];

    try {
      for (const recipientId of targetRecipientIds) {
        let targetChatId = recipientId;

        // Check if it's a direct friend UID
        const isFriend = availableFriends.some(f => f.uid === recipientId);
        if (isFriend) {
          targetChatId = await getOrCreateChat(currentUser.uid, recipientId);
        }

        affectedChatIds.push(targetChatId);

        // 1. Send all media items to this chat
        for (let m = 0; m < mediaItems.length; m++) {
          const item = mediaItems[m];
          // Include caption with the first media item if provided
          const itemCaption = (m === 0 && caption.trim()) ? caption.trim() : '';

          if (item.type === 'image') {
            await sendMessage(
              targetChatId,
              currentUser.uid,
              itemCaption,
              'image',
              item.dataUrl,
              currentUser
            );
          } else if (item.type === 'video') {
            await sendMessage(
              targetChatId,
              currentUser.uid,
              itemCaption,
              'video',
              item.dataUrl,
              currentUser,
              {
                mediaThumbnail: item.thumbnailUrl,
                mediaDuration: item.duration
              }
            );
          }
        }

        // If no media was attached but caption was typed
        if (mediaItems.length === 0 && caption.trim()) {
          await sendMessage(
            targetChatId,
            currentUser.uid,
            caption.trim(),
            'text',
            undefined,
            currentUser
          );
        }
      }

      setStatusMessage('Media shared successfully!');
      setTimeout(() => {
        onSuccess?.(affectedChatIds);
        onClose();
      }, 600);
    } catch (err: any) {
      console.error('Error sharing media:', err);
      alert('Failed to send media to some recipients. Please check your connection.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendBroadcast = () => handleSendToRecipients(selectedRecipientIds);

  const filteredFriends = availableFriends.filter(f => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q);
  });

  const filteredGroups = groupChats.filter(g => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (g.groupName || '').toLowerCase().includes(q);
  });

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col h-[92dvh] sm:h-auto sm:max-h-[88vh]"
      >
        
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-2xl shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">Share Photos & Videos</h2>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">Share with selected friends and group chats</p>
            </div>
          </div>

          {/* Quick Header Cancel & Close for Mobile */}
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors min-h-[36px] flex items-center justify-center cursor-pointer"
              title="Cancel sharing"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Media Preview & Attachment Strip */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200/70 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 overflow-x-auto pb-2">
            {mediaItems.map((item, idx) => (
              <div key={idx} className="relative group shrink-0 w-20 h-20 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950 shadow-2xs">
                {item.type === 'image' ? (
                  <img src={item.dataUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full relative flex items-center justify-center bg-slate-900">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="Video thumbnail" className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <VideoIcon className="w-6 h-6 text-white" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="p-1 bg-black/60 rounded-full">
                        <VideoIcon className="w-3.5 h-3.5 text-white" />
                      </div>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveMedia(idx)}
                  className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-white rounded-full transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Add More Media Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingFiles || isSending}
              className="shrink-0 w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 hover:text-blue-600 transition-all gap-1 text-[10px] font-semibold bg-white dark:bg-slate-800/80"
            >
              {isProcessingFiles ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  <span>Add Media</span>
                </>
              )}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleAddMediaFiles}
            className="hidden"
          />

          {/* Caption Input */}
          <div className="mt-3">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add an optional caption for this media..."
              className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {/* Recipient Selection */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends & groups..."
              className="w-full pl-9 pr-4 py-1.5 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-xs text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={handleSelectAll}
            className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-xl transition-colors shrink-0"
          >
            {selectedRecipientIds.length === (availableFriends.filter(f => !f.isBlocked).length + groupChats.length) ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {/* Recipients List */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Group Chats Section */}
          {filteredGroups.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block px-1">
                Group Chats ({filteredGroups.length})
              </span>
              <div className="space-y-1">
                {filteredGroups.map(group => {
                  const isSelected = selectedRecipientIds.includes(group.id);
                  return (
                    <div
                      key={group.id}
                      onClick={() => handleToggleRecipient(group.id)}
                      className={`flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-all border ${
                        isSelected 
                          ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80' 
                          : 'bg-white dark:bg-slate-800/40 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <EnlargeableAvatar
                          src={group.groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${group.id}`}
                          alt={group.groupName || 'Group'}
                          name={group.groupName || 'Group'}
                          isGroup={true}
                          sizeClass="w-9 h-9 rounded-xl"
                        />
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {group.groupName || 'Group Chat'}
                          </h4>
                          <p className="text-[10px] text-slate-400">
                            {group.participants?.length || 0} members
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendToRecipients([group.id]);
                          }}
                          className="px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 transition-colors"
                        >
                          Quick Send
                        </button>
                        <div className="text-blue-600 dark:text-blue-400">
                          {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Friends Section */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block px-1">
              Friends ({filteredFriends.length})
            </span>
            {filteredFriends.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No friends found</p>
            ) : (
              <div className="space-y-1">
                {filteredFriends.map(friend => {
                  const isSelected = selectedRecipientIds.includes(friend.uid);
                  const isBlocked = friend.isBlocked;

                  return (
                    <div
                      key={friend.uid}
                      onClick={() => handleToggleRecipient(friend.uid, isBlocked)}
                      className={`flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-all border ${
                        isBlocked
                          ? 'opacity-50 cursor-not-allowed bg-slate-100/50 dark:bg-slate-800/20 border-transparent'
                          : isSelected 
                            ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80' 
                            : 'bg-white dark:bg-slate-800/40 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <EnlargeableAvatar
                          src={friend.photoURL}
                          alt={friend.displayName}
                          name={friend.displayName}
                          uid={friend.uid}
                          sizeClass="w-9 h-9 rounded-xl"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {friend.displayName}
                            </h4>
                            {isBlocked && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-rose-100 dark:bg-rose-950 text-rose-600 rounded-full font-semibold">
                                Blocked
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-slate-400 truncate">
                            @{friend.username}{friend.userTag}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isBlocked && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendToRecipients([friend.uid]);
                            }}
                            className="px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 transition-colors"
                          >
                            Quick Send
                          </button>
                        )}
                        <div>
                          {isBlocked ? (
                            <span className="text-[10px] text-slate-400 italic">Cannot send</span>
                          ) : isSelected ? (
                            <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer with Send Button */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 shrink-0 sticky bottom-0 z-10 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate text-center sm:text-left">
            {selectedRecipientIds.length > 0 ? (
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Sharing with {selectedRecipientIds.length} recipient{selectedRecipientIds.length > 1 ? 's' : ''}
              </span>
            ) : (
              <span>Select recipients above or use Quick Send</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-3 sm:py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSendBroadcast}
              disabled={isSending || selectedRecipientIds.length === 0 || (mediaItems.length === 0 && !caption.trim())}
              className="flex-1 sm:flex-none px-5 py-3 sm:py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-all disabled:opacity-40 disabled:shadow-none cursor-pointer"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Share Media ({mediaItems.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  X, 
  Send, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  Check, 
  Search, 
  Loader2, 
  Users2, 
  Plus,
  Play,
  ArrowLeft
} from 'lucide-react';
import { UserProfile, ChatRoom } from '../types';
import { isUserBlockedLocally } from '../services/blockService';
import { getOrCreateChat, sendMessage } from '../services/chatService';
import { compressImage } from '../utils/imageUtils';
import { processVideoFile } from '../utils/mediaUtils';
import { EnlargeableAvatar } from './EnlargeableAvatar';
import { PendingSharePayload } from '../utils/apkIntentHandler';

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
  initialCaption?: string;
  initialPayload?: PendingSharePayload;
  onClose: () => void;
  onSuccess?: (chatIds: string[]) => void;
}

export const ShareMediaModal: React.FC<ShareMediaModalProps> = ({
  currentUser,
  friends,
  chats,
  initialItems = [],
  initialCaption = '',
  initialPayload,
  onClose,
  onSuccess
}) => {
  const [mediaItems, setMediaItems] = useState<SharedMediaItem[]>(
    initialPayload?.items && initialPayload.items.length > 0 
      ? initialPayload.items 
      : initialItems
  );
  const [caption, setCaption] = useState<string>(
    initialPayload?.text || initialCaption || ''
  );
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendingRecipientId, setSendingRecipientId] = useState<string | null>(null);
  const [sentRecipientIds, setSentRecipientIds] = useState<Set<string>>(new Set());
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPayload?.items && initialPayload.items.length > 0) {
      setMediaItems(initialPayload.items);
    } else if (initialItems && initialItems.length > 0) {
      setMediaItems(initialItems);
    }
    if (initialPayload?.text) {
      setCaption(initialPayload.text);
    } else if (initialCaption) {
      setCaption(initialCaption);
    }
  }, [initialItems, initialCaption, initialPayload]);

  // Support mobile back navigation and desktop Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

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

  // Group chats available
  const groupChats = useMemo(() => chats.filter(c => c.isGroup), [chats]);

  // Combine direct accepted friends with any 1-on-1 chat contacts so all friends are accessible
  const availableFriends = useMemo(() => {
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

  const filteredFriends = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return availableFriends;
    return availableFriends.filter(f => 
      f.displayName.toLowerCase().includes(q) ||
      f.username.toLowerCase().includes(q)
    );
  }, [availableFriends, searchQuery]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return groupChats;
    return groupChats.filter(g => 
      (g.groupName || 'Group').toLowerCase().includes(q)
    );
  }, [groupChats, searchQuery]);

  const allSelectableIds = useMemo(() => {
    const friendIds = filteredFriends.filter(f => !f.isBlocked).map(f => f.uid);
    const groupIds = filteredGroups.map(g => g.id);
    return [...friendIds, ...groupIds];
  }, [filteredFriends, filteredGroups]);

  const isAllSelected = allSelectableIds.length > 0 && 
    allSelectableIds.every(id => selectedRecipientIds.includes(id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedRecipientIds([]);
    } else {
      setSelectedRecipientIds(allSelectableIds);
    }
  };

  const handleToggleRecipient = (id: string, isBlocked = false) => {
    if (isBlocked) {
      alert('This user is currently blocked on your device. Unblock them first to share media.');
      return;
    }
    setSelectedRecipientIds(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const handleAddMediaFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingFiles(true);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveMedia = (index: number) => {
    setMediaItems(prev => prev.filter((_, idx) => idx !== index));
  };

  // 1-Tap automatic send to one or multiple recipients (matching ShareLinkModal)
  const handleSendToRecipients = async (targetRecipientIds: string[]) => {
    if (targetRecipientIds.length === 0) {
      alert('Please select at least one friend or group.');
      return;
    }

    if (mediaItems.length === 0 && !caption.trim()) {
      alert('Please add at least one photo, video, or message.');
      return;
    }

    setIsSending(true);
    if (targetRecipientIds.length === 1) {
      setSendingRecipientId(targetRecipientIds[0]);
    }

    const affectedChatIds: string[] = [];

    try {
      for (const recipientId of targetRecipientIds) {
        let targetChatId = recipientId;
        const isFriend = availableFriends.some(f => f.uid === recipientId);
        if (isFriend) {
          targetChatId = await getOrCreateChat(currentUser.uid, recipientId);
        }

        affectedChatIds.push(targetChatId);

        // 1. Send all media items to this chat
        for (let m = 0; m < mediaItems.length; m++) {
          const item = mediaItems[m];
          // Attach caption with first media item
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

        // 2. If no media attached but text caption was entered
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

        setSentRecipientIds(prev => new Set([...prev, recipientId]));
      }

      // Automatically complete and open chat or return
      setTimeout(() => {
        if (onSuccess) {
          onSuccess(affectedChatIds);
        } else {
          onClose();
        }
      }, 350);
    } catch (err) {
      console.error('Error sharing media:', err);
      alert('Failed to send media. Please check your connection and try again.');
    } finally {
      setIsSending(false);
      setSendingRecipientId(null);
    }
  };

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[94dvh] sm:h-auto sm:max-h-[90vh] overflow-hidden"
      >
        
        {/* Header - Identical to ShareLinkModal */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-2 -ml-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Cancel"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-1.5 truncate">
                <span>Send to...</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400">
                  {mediaItems.length} {mediaItems.length === 1 ? 'file' : 'files'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {selectedRecipientIds.length > 0 
                  ? `${selectedRecipientIds.length} contact${selectedRecipientIds.length > 1 ? 's' : ''} selected` 
                  : 'Tap any friend to send automatically'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-200/70 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors min-h-[36px] flex items-center justify-center cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Media Preview Strip & Caption Card */}
        <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-800 shrink-0 space-y-2.5">
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            {mediaItems.map((item, idx) => (
              <div 
                key={idx} 
                className="relative group shrink-0 w-16 h-16 sm:w-18 sm:h-18 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950 shadow-2xs"
              >
                {item.type === 'image' ? (
                  <img src={item.dataUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full relative flex items-center justify-center bg-slate-900">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="Video thumbnail" className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <VideoIcon className="w-5 h-5 text-white" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="w-4 h-4 fill-white text-white" />
                    </div>
                  </div>
                )}
                
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => handleRemoveMedia(idx)}
                  className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-white rounded-full transition-colors cursor-pointer"
                  title="Remove item"
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
              className="shrink-0 w-16 h-16 sm:w-18 sm:h-18 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all gap-1 text-[10px] font-semibold bg-white dark:bg-slate-800/80 cursor-pointer"
              title="Add more photos or videos"
            >
              {isProcessingFiles ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  <span>Add</span>
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

          {/* Optional Caption Toggle / Edit */}
          {showCaptionEdit ? (
            <div className="flex items-center gap-2 animate-in fade-in duration-100">
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a message to go with this media (optional)..."
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCaptionEdit(false)}
                className="px-2.5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
              <span className="truncate max-w-[70%]">
                {caption ? `Message: "${caption}"` : `${mediaItems.length} media item${mediaItems.length > 1 ? 's' : ''} ready`}
              </span>
              <button
                type="button"
                onClick={() => setShowCaptionEdit(true)}
                className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer shrink-0"
              >
                {caption ? 'Edit caption' : '+ Add message'}
              </button>
            </div>
          )}
        </div>

        {/* Search Input - Identical to ShareLinkModal */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends or groups..."
              className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800/80 border border-transparent dark:border-slate-700/60 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Scrollable Contacts List - Sharing List matching ShareLinkModal */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 p-2 sm:p-3">
          
          {/* Group Chats Section */}
          {filteredGroups.length > 0 && (
            <div className="pb-2">
              <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Group Chats
              </div>
              {filteredGroups.map(group => {
                const isSelected = selectedRecipientIds.includes(group.id);
                const isItemSending = isSending && sendingRecipientId === group.id;
                const isSent = sentRecipientIds.has(group.id);

                return (
                  <div
                    key={group.id}
                    onClick={() => handleToggleRecipient(group.id)}
                    className={`p-2.5 rounded-2xl flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected 
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100' 
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                        <Users2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 text-left">
                        <h4 className="text-sm font-semibold truncate leading-tight">{group.groupName || 'Group Chat'}</h4>
                        <p className="text-[11px] text-slate-400 truncate">
                          {group.participants?.length || 0} members
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => handleSendToRecipients([group.id])}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                          isSent
                            ? 'bg-emerald-500 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {isItemSending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isSent ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Sent</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Send</span>
                          </>
                        )}
                      </button>

                      <div 
                        onClick={() => handleToggleRecipient(group.id)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-blue-600 border-blue-600 text-white' 
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Friends Section */}
          <div className="pt-2">
            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Friends ({filteredFriends.length})</span>
              {allSelectableIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  {isAllSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {filteredFriends.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs">
                No friends found matching "{searchQuery}"
              </div>
            )}

            {filteredFriends.map(friend => {
              const isSelected = selectedRecipientIds.includes(friend.uid);
              const isItemSending = isSending && sendingRecipientId === friend.uid;
              const isSent = sentRecipientIds.has(friend.uid);

              return (
                <div
                  key={friend.uid}
                  onClick={() => !friend.isBlocked && handleToggleRecipient(friend.uid)}
                  className={`p-2.5 rounded-2xl flex items-center justify-between cursor-pointer transition-colors ${
                    friend.isBlocked
                      ? 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-slate-900'
                      : isSelected 
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100' 
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <EnlargeableAvatar
                        src={friend.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                        alt={friend.displayName}
                        size="md"
                        isOnline={friend.isOnline}
                        name={friend.displayName}
                      />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-semibold truncate leading-tight text-slate-900 dark:text-white">
                          {friend.displayName}
                        </h4>
                        {friend.isOnline && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        @{friend.username}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                    {/* Instant Direct Send Button */}
                    {!friend.isBlocked ? (
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => handleSendToRecipients([friend.uid])}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                          isSent
                            ? 'bg-emerald-500 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                        title={`Share directly with ${friend.displayName}`}
                      >
                        {isItemSending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isSent ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Sent</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Send</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">Blocked</span>
                    )}

                    {!friend.isBlocked && (
                      <div 
                        onClick={() => handleToggleRecipient(friend.uid)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-blue-600 border-blue-600 text-white' 
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* WhatsApp-Style Bottom Send Action (shows when 1 or more contacts selected) */}
        {selectedRecipientIds.length > 0 && (
          <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 sticky bottom-0 z-10 pb-[max(0.875rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-2 duration-150">
            <div className="text-xs text-slate-600 dark:text-slate-300 font-semibold truncate">
              Sharing with {selectedRecipientIds.length} recipient{selectedRecipientIds.length > 1 ? 's' : ''}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSending || selectedRecipientIds.length === 0}
                onClick={() => handleSendToRecipients(selectedRecipientIds)}
                className="px-5 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send ({selectedRecipientIds.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

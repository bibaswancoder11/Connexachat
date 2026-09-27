import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  X, 
  Send, 
  Search, 
  Check, 
  Loader2, 
  Users2, 
  Link as LinkIcon, 
  Globe, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  FileText, 
  Smile, 
  ArrowLeft,
  Share2
} from 'lucide-react';
import { UserProfile, ChatRoom } from '../types';
import { isUserBlockedLocally } from '../services/blockService';
import { getOrCreateChat, sendMessage } from '../services/chatService';
import { EnlargeableAvatar } from './EnlargeableAvatar';
import { EmojiPickerPopup } from './EmojiPickerPopup';
import { getDomainFromUrl, normalizeUrl } from '../utils/urlUtils';

export interface UniversalShareItem {
  type: 'image' | 'video' | 'file';
  dataUrl: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface UniversalSharePayload {
  type: 'link' | 'media' | 'file' | 'text';
  url?: string;
  title?: string;
  items?: UniversalShareItem[];
  caption?: string;
  text?: string;
  source?: string;
}

interface UniversalShareModalProps {
  currentUser: UserProfile;
  friends: UserProfile[];
  chats: ChatRoom[];
  payload: UniversalSharePayload;
  onClose: () => void;
  onSuccess?: (chatIds: string[]) => void;
}

export const UniversalShareModal: React.FC<UniversalShareModalProps> = ({
  currentUser,
  friends,
  chats,
  payload,
  onClose,
  onSuccess
}) => {
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [caption, setCaption] = useState<string>(payload.caption || payload.text || '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendingStatusText, setSendingStatusText] = useState<string>('');

  const captionInputRef = useRef<HTMLInputElement>(null);

  // Sync initial caption
  useEffect(() => {
    if (payload.caption || payload.text) {
      setCaption(payload.caption || payload.text || '');
    }
  }, [payload]);

  // Support Android physical back button & desktop Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const stateId = `universal-share-${Date.now()}`;
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

  // Determine recipients list (Recent Chats, Groups, and Friends)
  const allRecipients = useMemo(() => {
    const list: Array<{
      id: string; // chatId or friend uid
      isGroup: boolean;
      name: string;
      subtitle: string;
      avatar: string;
      chatId?: string;
      friendUid?: string;
      isBlocked?: boolean;
      memberCount?: number;
      isRecent?: boolean;
    }> = [];

    const addedUids = new Set<string>();

    // 1. Existing Chats (sorted by latest activity)
    chats.forEach(chat => {
      if (chat.isGroup) {
        list.push({
          id: chat.id,
          isGroup: true,
          name: chat.groupName || 'Group Chat',
          subtitle: `${chat.participants?.length || 0} members`,
          avatar: chat.groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${chat.id}`,
          chatId: chat.id,
          memberCount: chat.participants?.length || 0,
          isRecent: Boolean(chat.lastMessage)
        });
      } else if (chat.otherUser) {
        addedUids.add(chat.otherUser.uid);
        const blocked = isUserBlockedLocally(currentUser.uid, chat.otherUser.uid);
        list.push({
          id: chat.id,
          isGroup: false,
          name: chat.otherUser.displayName,
          subtitle: `@${chat.otherUser.username}`,
          avatar: chat.otherUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.otherUser.uid}`,
          chatId: chat.id,
          friendUid: chat.otherUser.uid,
          isBlocked: blocked,
          isRecent: Boolean(chat.lastMessage)
        });
      }
    });

    // 2. Friends who do not have an active chat yet
    friends.forEach(friend => {
      if (!addedUids.has(friend.uid)) {
        const blocked = isUserBlockedLocally(currentUser.uid, friend.uid);
        list.push({
          id: `friend_${friend.uid}`,
          isGroup: false,
          name: friend.displayName,
          subtitle: `@${friend.username}`,
          avatar: friend.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.uid}`,
          friendUid: friend.uid,
          isBlocked: blocked,
          isRecent: false
        });
      }
    });

    return list;
  }, [chats, friends, currentUser.uid]);

  // Filter recipients based on search query
  const filteredRecipients = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return allRecipients;
    return allRecipients.filter(r => 
      r.name.toLowerCase().includes(q) || 
      r.subtitle.toLowerCase().includes(q)
    );
  }, [allRecipients, searchQuery]);

  // Toggle selection
  const toggleRecipient = (id: string, isBlocked?: boolean) => {
    if (isBlocked) {
      alert('You have blocked this contact. Unblock them in settings to share.');
      return;
    }
    setSelectedRecipientIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Quick lookup for selected recipient objects
  const selectedRecipients = useMemo(() => {
    return selectedRecipientIds
      .map(id => allRecipients.find(r => r.id === id))
      .filter(Boolean) as Array<typeof allRecipients[0]>;
  }, [selectedRecipientIds, allRecipients]);

  // Handle emoji insertion
  const handleSelectEmoji = (emoji: string) => {
    const input = captionInputRef.current;
    if (input) {
      const start = input.selectionStart ?? caption.length;
      const end = input.selectionEnd ?? caption.length;
      const newText = caption.substring(0, start) + emoji + caption.substring(end);
      setCaption(newText);
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setCaption(prev => prev + emoji);
    }
  };

  // Perform multi-send (WhatsApp style)
  const handleSend = async () => {
    if (selectedRecipientIds.length === 0 || isSending) return;

    setIsSending(true);
    setSendingStatusText(`Sending to ${selectedRecipientIds.length} chat${selectedRecipientIds.length > 1 ? 's' : ''}...`);

    const dispatchedChatIds: string[] = [];

    try {
      for (const recId of selectedRecipientIds) {
        const target = allRecipients.find(r => r.id === recId);
        if (!target) continue;

        let targetChatId = target.chatId;
        if (!targetChatId && target.friendUid) {
          targetChatId = await getOrCreateChat(currentUser.uid, target.friendUid);
        }
        if (!targetChatId) continue;

        dispatchedChatIds.push(targetChatId);

        // 1. Sending Link
        if (payload.type === 'link' && payload.url) {
          const finalUrl = normalizeUrl(payload.url);
          const finalMsg = caption.trim() 
            ? `${caption.trim()}\n${finalUrl}` 
            : finalUrl;
          await sendMessage(targetChatId, currentUser.uid, finalMsg, 'text', undefined, currentUser);
        }
        // 2. Sending Media (Images or Videos)
        else if (payload.type === 'media' && payload.items && payload.items.length > 0) {
          for (let i = 0; i < payload.items.length; i++) {
            const item = payload.items[i];
            const itemCaption = i === 0 ? caption.trim() : '';
            await sendMessage(
              targetChatId, 
              currentUser.uid, 
              itemCaption, 
              item.type, 
              item.dataUrl, 
              currentUser,
              {
                mediaThumbnail: item.thumbnailUrl,
                mediaDuration: item.duration,
                mediaSize: item.size,
                filename: item.filename
              }
            );
          }
        }
        // 3. Sending Document / File
        else if (payload.type === 'file' && payload.items && payload.items.length > 0) {
          for (let i = 0; i < payload.items.length; i++) {
            const item = payload.items[i];
            const itemCaption = i === 0 ? caption.trim() : '';
            await sendMessage(
              targetChatId,
              currentUser.uid,
              itemCaption,
              'file',
              item.dataUrl,
              currentUser,
              {
                filename: item.filename || 'Document',
                mediaSize: item.size,
                fileType: item.mimeType
              }
            );
          }
        }
        // 4. Sending Text
        else {
          const textToSend = caption.trim() || payload.text?.trim() || '';
          if (textToSend) {
            await sendMessage(targetChatId, currentUser.uid, textToSend, 'text', undefined, currentUser);
          }
        }
      }

      onSuccess?.(dispatchedChatIds);
    } catch (err) {
      console.error('Error dispatching universal share:', err);
      alert('Failed to send shared item to some recipients. Please check your connection.');
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center sm:p-4 animate-in fade-in duration-150">
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* WhatsApp-Style Header */}
        <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="p-2 -ml-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Cancel sharing"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="font-bold text-base text-slate-900 dark:text-white">
                Send to...
              </h2>
              <p className="text-[11px] text-slate-400">
                {selectedRecipientIds.length === 0 
                  ? 'Select contacts or groups' 
                  : `${selectedRecipientIds.length} chat${selectedRecipientIds.length > 1 ? 's' : ''} selected`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Being Shared Preview Card */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 shrink-0">
          
          {/* 1. Link Preview */}
          {payload.type === 'link' && payload.url && (
            <div className="p-2.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block truncate">
                  {getDomainFromUrl(payload.url)}
                </span>
                <p className="text-xs text-slate-800 dark:text-slate-200 font-medium truncate">
                  {payload.title || payload.url}
                </p>
              </div>
            </div>
          )}

          {/* 2. Media Preview (Image or Video) */}
          {payload.type === 'media' && payload.items && payload.items.length > 0 && (
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-black shrink-0 relative flex items-center justify-center">
                {payload.items[0].type === 'video' ? (
                  <>
                    <img 
                      src={payload.items[0].thumbnailUrl || payload.items[0].dataUrl} 
                      alt="Thumbnail" 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                      <VideoIcon className="w-5 h-5" />
                    </div>
                  </>
                ) : (
                  <img 
                    src={payload.items[0].dataUrl} 
                    alt="Media preview" 
                    className="w-full h-full object-cover" 
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {payload.items[0].type === 'video' ? <VideoIcon className="w-4 h-4 text-purple-500" /> : <ImageIcon className="w-4 h-4 text-blue-500" />}
                  <span>{payload.items.length > 1 ? `${payload.items.length} media items` : (payload.items[0].type === 'video' ? 'Video' : 'Photo')}</span>
                </div>
                {payload.items[0].filename && (
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {payload.items[0].filename}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 3. Document / File Preview */}
          {payload.type === 'file' && payload.items && payload.items.length > 0 && (
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div className="p-3 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-xl shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                  {payload.items[0].filename || 'Document'}
                </p>
                <p className="text-[10px] text-slate-400">
                  {payload.items[0].size 
                    ? `${(payload.items[0].size / (1024 * 1024)).toFixed(1)} MB` 
                    : 'File attachment'}
                </p>
              </div>
            </div>
          )}

          {/* 4. Text Preview (if not link/media/file) */}
          {payload.type === 'text' && payload.text && (
            <div className="p-2.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2 italic">
                "{payload.text}"
              </p>
            </div>
          )}

          {/* Optional Caption Input Field with Emoji Picker */}
          <div className="relative mt-2.5 flex items-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-2 py-1 focus-within:ring-2 focus-within:ring-blue-500/30">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              title="Add emoji"
            >
              <Smile className="w-4 h-4" />
            </button>

            <input
              ref={captionInputRef}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add an optional caption..."
              className="flex-1 min-w-0 py-1.5 px-2 bg-transparent border-none text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden"
            />

            {caption && (
              <button
                type="button"
                onClick={() => setCaption('')}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {showEmojiPicker && (
              <EmojiPickerPopup
                onSelectEmoji={handleSelectEmoji}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Selected Recipients Horizontal Pill Strip */}
        {selectedRecipients.length > 0 && (
          <div className="p-2 bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/60 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
            {selectedRecipients.map(r => (
              <div 
                key={r.id} 
                className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 rounded-full text-xs font-semibold text-slate-800 dark:text-slate-200 shadow-2xs shrink-0 animate-in zoom-in-95 duration-100"
              >
                <img 
                  src={r.avatar} 
                  alt={r.name} 
                  className="w-4 h-4 rounded-full object-cover" 
                />
                <span className="max-w-[100px] truncate text-[11px]">{r.name}</span>
                <button
                  type="button"
                  onClick={() => toggleRecipient(r.id)}
                  className="p-0.5 text-slate-400 hover:text-rose-500 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search Bar for Contacts & Groups */}
        <div className="p-2 sm:p-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts and groups..."
              className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800/80 border border-transparent dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Recipients List with WhatsApp-Style Checkmarks */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {filteredRecipients.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No contacts or groups found matching "{searchQuery}"
            </div>
          ) : (
            filteredRecipients.map(r => {
              const isSelected = selectedRecipientIds.includes(r.id);

              return (
                <div
                  key={r.id}
                  onClick={() => toggleRecipient(r.id, r.isBlocked)}
                  className={`p-3 sm:px-4 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected 
                      ? 'bg-blue-50/80 dark:bg-blue-950/40' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  } ${r.isBlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <img 
                        src={r.avatar} 
                        alt={r.name} 
                        className="w-11 h-11 rounded-2xl object-cover border border-slate-200/60 dark:border-slate-700/60" 
                      />
                      {r.isGroup && (
                        <div className="absolute -bottom-1 -right-1 p-0.5 bg-blue-600 text-white rounded-full">
                          <Users2 className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {r.name}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {r.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* WhatsApp-Style Circular Checkbox */}
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                    isSelected 
                      ? 'bg-blue-600 border-blue-600 text-white shadow-xs scale-105' 
                      : 'border-slate-300 dark:border-slate-600 bg-transparent'
                  }`}>
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* WhatsApp-Style Bottom Bar with Floating Send FAB */}
        <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="min-w-0 flex-1">
            {selectedRecipientIds.length > 0 ? (
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                Sending to {selectedRecipientIds.length} recipient{selectedRecipientIds.length > 1 ? 's' : ''}
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                Tap contacts to select recipients
              </p>
            )}
          </div>

          {/* Floating Action Button (FAB) for Send */}
          <button
            type="button"
            disabled={selectedRecipientIds.length === 0 || isSending}
            onClick={handleSend}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-lg ${
              selectedRecipientIds.length > 0 && !isSending
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/30 scale-100 active:scale-95'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-50 shadow-none'
            }`}
            title="Send"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5 ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

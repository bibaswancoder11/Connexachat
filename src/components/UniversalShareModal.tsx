import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Send,
  Search,
  Check,
  Loader2,
  Users2,
  Globe,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Smile,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { UserProfile, ChatRoom } from '../types';
import { isUserBlockedLocally } from '../services/blockService';
import { getOrCreateChat, sendMessage } from '../services/chatService';
import { uploadLargeMedia, MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_MB } from '../services/mediaStorageService';
import { EmojiPickerPopup } from './EmojiPickerPopup';
import { getDomainFromUrl, normalizeUrl } from '../utils/urlUtils';

export interface UniversalShareItem {
  type: 'image' | 'video' | 'file';
  dataUrl: string;
  file?: File | Blob;
  filename?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
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

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'Attachment';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileExtensionBadge(filename?: string, mimeType?: string): string {
  if (filename && filename.includes('.')) {
    const ext = filename.split('.').pop()?.toUpperCase();
    if (ext && ext.length <= 6) return ext;
  }
  if (mimeType) {
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'DOC';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'XLS';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'PPT';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'ZIP';
    if (mimeType.startsWith('audio/')) return 'AUDIO';
    if (mimeType.startsWith('text/')) return 'TXT';
  }
  return 'FILE';
}

interface ShareRecipientOption {
  id: string;
  isGroup: boolean;
  name: string;
  subtitle: string;
  avatar: string;
  chatId?: string;
  friendUid?: string;
  isBlocked?: boolean;
  memberCount?: number;
  section: 'recent' | 'contacts';
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
  const [caption, setCaption] = useState<string>(() => {
    const rawCap = payload.caption ?? payload.text ?? '';
    if (payload.type === 'link' && payload.url) {
      return rawCap.replace(payload.url, '').trim();
    }
    return rawCap;
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>(() => {
    const errItem = payload.items?.find(i => i.error);
    return errItem?.error || '';
  });

  const captionInputRef = useRef<HTMLInputElement>(null);

  // Sync caption when a new share payload arrives
  useEffect(() => {
    const rawCap = payload.caption ?? payload.text ?? '';
    if (payload.type === 'link' && payload.url) {
      setCaption(rawCap.replace(payload.url, '').trim());
    } else {
      setCaption(rawCap);
    }
    const errItem = payload.items?.find(i => i.error);
    setErrorMessage(errItem?.error || '');
    setUploadProgress(null);
  }, [payload]);

  // Support Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSending) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSending]);

  // Build WhatsApp-style categorized recipients list (Accepted Friends & Active Groups ONLY)
  const allRecipients = useMemo(() => {
    const list: ShareRecipientOption[] = [];
    const friendUidSet = new Set(friends.map(f => f.uid));
    const addedFriendUids = new Set<string>();

    // 1. Recent Chats & Groups (only include 1-on-1 chats if the user is an accepted friend)
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
          section: 'recent'
        });
      } else if (chat.otherUser && friendUidSet.has(chat.otherUser.uid)) {
        addedFriendUids.add(chat.otherUser.uid);
        const blocked = isUserBlockedLocally(currentUser.uid, chat.otherUser.uid);
        list.push({
          id: chat.id,
          isGroup: false,
          name: chat.otherUser.displayName,
          subtitle: `@${chat.otherUser.username}${chat.otherUser.userTag || ''}`,
          avatar: chat.otherUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.otherUser.uid}`,
          chatId: chat.id,
          friendUid: chat.otherUser.uid,
          isBlocked: blocked,
          section: 'recent'
        });
      }
    });

    // 2. Remaining Friends on Connexa
    friends.forEach(friend => {
      if (!addedFriendUids.has(friend.uid)) {
        const blocked = isUserBlockedLocally(currentUser.uid, friend.uid);
        list.push({
          id: `friend_${friend.uid}`,
          isGroup: false,
          name: friend.displayName,
          subtitle: `@${friend.username}${friend.userTag || ''}`,
          avatar: friend.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.uid}`,
          friendUid: friend.uid,
          isBlocked: blocked,
          section: 'contacts'
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

  const recentRecipients = useMemo(
    () => filteredRecipients.filter(r => r.section === 'recent'),
    [filteredRecipients]
  );

  const contactRecipients = useMemo(
    () => filteredRecipients.filter(r => r.section === 'contacts'),
    [filteredRecipients]
  );

  // Toggle selection
  const toggleRecipient = (id: string, isBlocked?: boolean) => {
    if (isSending) return;
    if (isBlocked) {
      setErrorMessage('You have blocked this contact. Unblock them first to share.');
      return;
    }
    setErrorMessage('');
    setSelectedRecipientIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Selected recipient objects in selection order
  const selectedRecipients = useMemo(() => {
    return selectedRecipientIds
      .map(id => allRecipients.find(r => r.id === id))
      .filter(Boolean) as ShareRecipientOption[];
  }, [selectedRecipientIds, allRecipients]);

  // Handle emoji insertion into caption
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

  // Perform WhatsApp-style multi-recipient send (supports videos & files up to 55MB)
  const handleSend = async () => {
    if (selectedRecipientIds.length === 0 || isSending) return;

    // Validate item errors or size limits before starting
    if (payload.items && payload.items.length > 0) {
      for (const item of payload.items) {
        if (item.error) {
          setErrorMessage(item.error);
          return;
        }
        const itemBytes = item.file?.size ?? item.size ?? 0;
        if (itemBytes > MAX_VIDEO_SIZE_BYTES) {
          setErrorMessage(
            `${item.type === 'video' ? 'Video' : 'File'} is too large (${(itemBytes / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is ${MAX_VIDEO_SIZE_MB}MB.`
          );
          return;
        }
      }
    }

    setIsSending(true);
    setUploadProgress(null);
    setErrorMessage('');

    const dispatchedChatIds: string[] = [];

    try {
      // Pre-upload media/files ONCE so sharing a 55MB video to multiple friends doesn't upload multiple times
      let preparedItems: UniversalShareItem[] = payload.items || [];
      if ((payload.type === 'media' || payload.type === 'file') && preparedItems.length > 0) {
        const uploadedList: UniversalShareItem[] = [];
        for (let idx = 0; idx < preparedItems.length; idx++) {
          const rawItem = preparedItems[idx];
          const resolvedUrl = await uploadLargeMedia({
            blob: rawItem.file,
            dataUrl: rawItem.dataUrl,
            mimeType: rawItem.mimeType,
            filename: rawItem.filename,
            uploaderId: currentUser.uid,
            onProgress: (pct) => {
              const overall = Math.round(((idx * 100 + pct) / preparedItems.length));
              setUploadProgress(overall);
            }
          });
          uploadedList.push({
            ...rawItem,
            dataUrl: resolvedUrl,
            file: undefined
          });
        }
        preparedItems = uploadedList;
        setUploadProgress(100);
      }

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
          const trimmedCaption = caption.trim();
          const finalMsg = trimmedCaption
            ? `${trimmedCaption}\n${finalUrl}`
            : (payload.title && !finalUrl.includes(payload.title) ? `${payload.title}\n${finalUrl}` : finalUrl);
          await sendMessage(targetChatId, currentUser.uid, finalMsg, 'text', undefined, currentUser);
        }
        // 2. Sending Media & Mixed Items (Images, Videos up to 55MB, Documents)
        else if ((payload.type === 'media' || payload.type === 'file') && preparedItems.length > 0) {
          for (let i = 0; i < preparedItems.length; i++) {
            const item = preparedItems[i];
            const itemCaption = i === 0 ? caption.trim() : '';

            if (item.type === 'file') {
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
                  fileType: item.mimeType || 'application/octet-stream'
                }
              );
            } else {
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
                  filename: item.filename,
                  fileType: item.mimeType
                }
              );
            }
          }
        }
        // 3. Sending Text
        else {
          const textToSend = caption.trim() || payload.text?.trim() || '';
          if (textToSend) {
            await sendMessage(targetChatId, currentUser.uid, textToSend, 'text', undefined, currentUser);
          }
        }
      }

      onSuccess?.(dispatchedChatIds);
    } catch (err: any) {
      console.error('Error dispatching shared content:', err);
      setErrorMessage(err?.message || 'Failed to send shared item. Please check your connection and try again.');
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  const renderRecipientRow = (r: ShareRecipientOption) => {
    const isSelected = selectedRecipientIds.includes(r.id);

    return (
      <div
        key={r.id}
        onClick={() => toggleRecipient(r.id, r.isBlocked)}
        className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
          isSelected
            ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
        } ${r.isBlocked ? 'opacity-45 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative shrink-0">
            <img
              src={r.avatar}
              alt={r.name}
              className="w-11 h-11 rounded-full object-cover border border-slate-200/80 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800"
            />
            {isSelected ? (
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-emerald-500 text-white rounded-full ring-2 ring-white dark:ring-slate-900 flex items-center justify-center animate-in zoom-in-75 duration-100">
                <Check className="w-3 h-3 stroke-[3]" />
              </div>
            ) : r.isGroup ? (
              <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-blue-600 text-white rounded-full ring-2 ring-white dark:ring-slate-900">
                <Users2 className="w-2.5 h-2.5" />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              {r.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {r.isBlocked ? 'Blocked contact' : r.subtitle}
            </p>
          </div>
        </div>

        {/* Right Circular Selection Indicator */}
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
            isSelected
              ? 'bg-emerald-500 border-emerald-500 text-white scale-105'
              : 'border-slate-300 dark:border-slate-600 bg-transparent'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center sm:p-4 animate-in fade-in duration-150">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 w-full h-full sm:h-[88vh] sm:max-h-[760px] sm:max-w-md sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* Top WhatsApp-Style Header */}
        <div className="px-3 py-3 sm:px-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              disabled={isSending}
              onClick={onClose}
              className="p-2 -ml-1 text-slate-300 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2 className="font-bold text-base text-white truncate">
                Send to...
              </h2>
              <p className="text-[11px] text-slate-300 truncate">
                {selectedRecipientIds.length === 0
                  ? 'Tap contacts or groups to select'
                  : `${selectedRecipientIds.length} selected`}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSending}
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input Bar */}
        <div className="p-2.5 sm:px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or @username..."
              className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700/70 rounded-full text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30"
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

        {/* Shared Content Preview Card */}
        <div className="px-3 py-2.5 sm:px-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200/70 dark:border-slate-800 shrink-0">
          {/* 1. Link Preview */}
          {payload.type === 'link' && payload.url && (
            <div className="p-2.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 shadow-2xs">
              <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block truncate">
                  {getDomainFromUrl(payload.url)}
                </span>
                {payload.title && (
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {payload.title}
                  </p>
                )}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {payload.url}
                </p>
              </div>
            </div>
          )}

          {/* 2. Media Preview (Photos / Videos — single or multiple) */}
          {payload.type === 'media' && payload.items && payload.items.length > 0 && (
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-[140px] shrink-0">
                {payload.items.slice(0, 3).map((item, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 shrink-0 relative flex items-center justify-center border border-slate-200 dark:border-slate-700"
                  >
                    {item.type === 'video' ? (
                      <>
                        {item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt="Video" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-slate-800" />
                        )}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                          <VideoIcon className="w-4 h-4" />
                        </div>
                      </>
                    ) : item.type === 'image' ? (
                      <img src={item.dataUrl} alt="Photo" className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="w-5 h-5 text-amber-500" />
                    )}
                  </div>
                ))}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  {payload.items[0].type === 'video' ? (
                    <VideoIcon className="w-4 h-4 text-purple-500 shrink-0" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
                  )}
                  <span className="truncate">
                    {payload.items.length > 1
                      ? `${payload.items.length} items ready to share`
                      : payload.items[0].type === 'video'
                        ? 'Video clip'
                        : 'Photo'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {payload.items[0].filename || formatBytes(payload.items[0].size)}
                </p>
              </div>
            </div>
          )}

          {/* 3. Document / File Preview */}
          {payload.type === 'file' && payload.items && payload.items.length > 0 && (
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <div className="w-11 h-11 bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 rounded-xl shrink-0 flex flex-col items-center justify-center font-bold text-[10px] border border-amber-200/70 dark:border-amber-800/60">
                <FileText className="w-4 h-4 mb-0.5" />
                <span>{getFileExtensionBadge(payload.items[0].filename, payload.items[0].mimeType)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {payload.items.length > 1
                    ? `${payload.items.length} documents (${payload.items[0].filename || 'Files'})`
                    : (payload.items[0].filename || 'Document')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatBytes(payload.items[0].size)}
                </p>
              </div>
            </div>
          )}

          {/* 4. Plain Text Preview */}
          {payload.type === 'text' && (payload.text || payload.caption) && (
            <div className="p-2.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
                {payload.text || payload.caption}
              </p>
            </div>
          )}
        </div>

        {/* Inline Error Banner if any */}
        {errorMessage && (
          <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-900/60 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Contacts & Groups Selection List */}
        <div className="flex-1 overflow-y-auto">
          {filteredRecipients.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {allRecipients.length === 0 ? 'No friends or groups yet' : 'No matching chats found'}
              </p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                {allRecipients.length === 0
                  ? 'Add friends on Connexa to share photos, videos, documents, and links with them.'
                  : `No contacts or groups matched "${searchQuery}".`}
              </p>
            </div>
          ) : (
            <div className="pb-2">
              {recentRecipients.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50/70 dark:bg-slate-900/60 sticky top-0 z-10 backdrop-blur-xs">
                    Recent Chats & Groups
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {recentRecipients.map(renderRecipientRow)}
                  </div>
                </div>
              )}

              {contactRecipients.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50/70 dark:bg-slate-900/60 sticky top-0 z-10 backdrop-blur-xs">
                    Friends on Connexa
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {contactRecipients.map(renderRecipientRow)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* WhatsApp-Style Bottom Composer: Optional Caption + Selected Chips + Green/Blue Send FAB */}
        <div className="bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 p-3 space-y-2.5 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Optional Caption Bar */}
          <div className="relative flex items-center bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 shadow-2xs focus-within:ring-2 focus-within:ring-emerald-500/30">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              title="Add emoji"
            >
              <Smile className="w-4 h-4" />
            </button>

            <input
              ref={captionInputRef}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={payload.type === 'text' ? 'Edit message before sending...' : 'Add a caption...'}
              className="flex-1 min-w-0 py-1 px-2 bg-transparent border-none text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden"
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

          {/* Selected Recipients Summary + Send FAB Row */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
              {selectedRecipients.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  {selectedRecipients.map(r => (
                    <span
                      key={r.id}
                      onClick={() => toggleRecipient(r.id)}
                      className="inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[11px] font-medium text-slate-800 dark:text-slate-200 shrink-0 cursor-pointer hover:border-rose-300"
                      title="Tap to remove"
                    >
                      <img src={r.avatar} alt={r.name} className="w-4 h-4 rounded-full object-cover" />
                      <span className="max-w-[90px] truncate">{r.name}</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 pl-1">
                  Select at least 1 recipient to send
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={selectedRecipientIds.length === 0 || isSending}
              onClick={handleSend}
              className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shrink-0 shadow-lg ${
                selectedRecipientIds.length > 0 && !isSending
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30 cursor-pointer active:scale-95'
                  : 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed opacity-60 shadow-none'
              }`}
              title="Send"
            >
              {isSending ? (
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploadProgress !== null && (
                    <span className="text-[9px] font-bold leading-none mt-0.5">{uploadProgress}%</span>
                  )}
                </div>
              ) : (
                <>
                  <Send className="w-5 h-5 ml-0.5" />
                  {selectedRecipientIds.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-slate-100 dark:ring-slate-950">
                      {selectedRecipientIds.length}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

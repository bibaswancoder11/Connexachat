import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Send, 
  Link as LinkIcon, 
  ExternalLink, 
  Copy, 
  Check, 
  Search, 
  Loader2, 
  Users2, 
  CheckSquare, 
  Square, 
  Globe, 
  Share2,
  Sparkles
} from 'lucide-react';
import { UserProfile, ChatRoom } from '../types';
import { isUserBlockedLocally } from '../services/blockService';
import { getOrCreateChat, sendMessage } from '../services/chatService';
import { SharedLinkPayload } from '../utils/apkIntentHandler';
import { EnlargeableAvatar } from './EnlargeableAvatar';
import { openUrlInBrowser } from '../utils/urlUtils';

interface ShareLinkModalProps {
  currentUser: UserProfile;
  friends: UserProfile[];
  chats: ChatRoom[];
  initialPayload?: SharedLinkPayload;
  onClose: () => void;
  onSuccess?: (chatIds: string[]) => void;
}

export const ShareLinkModal: React.FC<ShareLinkModalProps> = ({
  currentUser,
  friends,
  chats,
  initialPayload,
  onClose,
  onSuccess
}) => {
  const [urlInput, setUrlInput] = useState<string>(initialPayload?.url || '');
  const [caption, setCaption] = useState<string>(initialPayload?.text || initialPayload?.title || '');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialPayload?.url) {
      setUrlInput(initialPayload.url);
    }
    if (initialPayload?.text || initialPayload?.title) {
      setCaption(initialPayload.text || initialPayload.title || '');
    }
  }, [initialPayload]);

  // Support mobile back navigation and desktop Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Support browser history / mobile swipe-back gesture to cancel modal cleanly
    const stateId = `share-link-modal-${Date.now()}`;
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

  // Parse hostname / domain safely
  const domainInfo = useMemo(() => {
    if (!urlInput) return null;
    let testUrl = urlInput.trim();
    if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
      testUrl = `https://${testUrl}`;
    }
    try {
      const parsed = new URL(testUrl);
      return {
        hostname: parsed.hostname.replace(/^www\./, ''),
        cleanUrl: parsed.href
      };
    } catch {
      return {
        hostname: testUrl.split('/')[0] || 'Link',
        cleanUrl: testUrl
      };
    }
  }, [urlInput]);

  const groupChats = useMemo(() => chats.filter(c => c.isGroup), [chats]);

  // Merge direct accepted friends with any 1-on-1 chat contacts so all friends are accessible
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
      alert('This user is currently blocked on your device. Unblock them first to share links.');
      return;
    }
    setSelectedRecipientIds(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const handleCopyLink = async () => {
    if (!urlInput) return;
    try {
      await navigator.clipboard.writeText(urlInput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
      }
    } catch (e) {
      console.warn('Clipboard read error:', e);
    }
  };

  const handleSendToChats = async (targetRecipientIds: string[]) => {
    const cleanUrl = urlInput.trim();
    if (!cleanUrl) {
      alert('Please provide a valid web link to share.');
      return;
    }

    if (targetRecipientIds.length === 0) {
      alert('Please select at least one recipient or group.');
      return;
    }

    setIsSending(true);
    setStatusMessage(`Sharing link with ${targetRecipientIds.length} recipient${targetRecipientIds.length > 1 ? 's' : ''}...`);

    const affectedChatIds: string[] = [];

    try {
      const messageBody = caption.trim() 
        ? `${caption.trim()}\n${cleanUrl}`
        : cleanUrl;

      for (const recipientId of targetRecipientIds) {
        let targetChatId = recipientId;
        const isFriend = availableFriends.some(f => f.uid === recipientId);
        if (isFriend) {
          targetChatId = await getOrCreateChat(currentUser.uid, recipientId);
        }

        affectedChatIds.push(targetChatId);

        await sendMessage(
          targetChatId,
          currentUser.uid,
          messageBody,
          'text',
          undefined,
          currentUser
        );
      }

      setStatusMessage('Link shared successfully!');
      if (onSuccess) {
        onSuccess(affectedChatIds);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Error sharing link:', err);
      alert('Failed to send link. Please check your connection and try again.');
    } finally {
      setIsSending(false);
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
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[92dvh] sm:h-auto sm:max-h-[88vh] overflow-hidden"
      >
        
        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 rounded-2xl shrink-0">
              <LinkIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-1.5 truncate">
                <span>Share Link</span>
                {initialPayload?.source && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 shrink-0">
                    From external app
                  </span>
                )}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                Send web links directly to friends or group chats
              </p>
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {/* Link Preview Card */}
          <div className="p-4 bg-blue-50/60 dark:bg-slate-800/60 rounded-2xl border border-blue-100 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  {domainInfo?.hostname || 'Web Link'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center gap-1 transition-colors"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                {urlInput && (
                  <button
                    type="button"
                    onClick={(e) => openUrlInBrowser(domainInfo?.cleanUrl || urlInput, e)}
                    className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors"
                    title="Open link in new tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* URL Input */}
            <div className="relative">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/..."
                className="w-full pl-3.5 pr-16 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
              />
              {!urlInput ? (
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="absolute right-2 top-2 px-2 py-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                >
                  Paste
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setUrlInput('')}
                  className="absolute right-2 top-2 p-1 text-slate-400 hover:text-rose-500 rounded-md transition-colors"
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Optional Caption / Note */}
            <div>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a message or note (optional)..."
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Select Recipients Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Select Recipients ({selectedRecipientIds.length})
              </span>
              {allSelectableIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  {isAllSelected ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Deselect All</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5" />
                      <span>Select All</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Search filter */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search friends or groups..."
                className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
              />
            </div>

            {/* Recipient List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto pr-1">
              {/* Group Chats */}
              {filteredGroups.length > 0 && (
                <div className="py-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Group Chats
                  </span>
                  {filteredGroups.map(group => {
                    const isSelected = selectedRecipientIds.includes(group.id);
                    return (
                      <div
                        key={group.id}
                        onClick={() => handleToggleRecipient(group.id)}
                        className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' 
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                            <Users2 className="w-4 h-4" />
                          </div>
                          <div className="text-left">
                            <h4 className="text-xs font-semibold leading-tight">{group.groupName || 'Group Chat'}</h4>
                            <p className="text-[10px] text-slate-400">
                              {group.participantIds?.length || 0} members
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendToChats([group.id]);
                            }}
                            className="px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 transition-colors"
                          >
                            Quick Send
                          </button>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                            isSelected 
                              ? 'bg-blue-600 border-blue-600 text-white' 
                              : 'border-slate-300 dark:border-slate-600'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Friends */}
              {filteredFriends.length > 0 && (
                <div className="py-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Direct Friends
                  </span>
                  {filteredFriends.map(friend => {
                    const isSelected = selectedRecipientIds.includes(friend.uid);
                    return (
                      <div
                        key={friend.uid}
                        onClick={() => handleToggleRecipient(friend.uid, friend.isBlocked)}
                        className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                          friend.isBlocked 
                            ? 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-slate-800/40' 
                            : isSelected 
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' 
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="relative shrink-0">
                            <EnlargeableAvatar
                              src={friend.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                              alt={friend.displayName}
                              size="sm"
                              isOnline={friend.status === 'online'}
                            />
                          </div>
                          <div className="text-left">
                            <h4 className="text-xs font-semibold leading-tight">{friend.displayName}</h4>
                            <p className="text-[10px] text-slate-400 font-mono">
                              @{friend.username}{friend.userTag}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!friend.isBlocked && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSendToChats([friend.uid]);
                              }}
                              className="px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 transition-colors"
                            >
                              Quick Send
                            </button>
                          )}
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                            isSelected 
                              ? 'bg-blue-600 border-blue-600 text-white' 
                              : 'border-slate-300 dark:border-slate-600'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredFriends.length === 0 && filteredGroups.length === 0 && (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No friends or groups found matching "{searchQuery}"
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 sticky bottom-0 z-10 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <div className="text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
            {statusMessage ? (
              <span className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{statusMessage}</span>
              </span>
            ) : (
              <span>
                {selectedRecipientIds.length === 0 
                  ? 'Pick recipients or use Quick Send' 
                  : `${selectedRecipientIds.length} conversation${selectedRecipientIds.length > 1 ? 's' : ''} selected`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-3 sm:py-2.5 min-h-[44px] text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center justify-center cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSending || !urlInput.trim() || selectedRecipientIds.length === 0}
              onClick={() => handleSendToChats(selectedRecipientIds)}
              className="flex-1 sm:flex-none px-5 py-3 sm:py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Link ({selectedRecipientIds.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

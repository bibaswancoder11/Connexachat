import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, UserX, Unlock, Search, Check, AlertTriangle, MessageSquare } from 'lucide-react';
import { LocalBlockedUser } from '../types';
import { getBlockedUsers, unblockUserLocally, subscribeToBlockedUsers } from '../services/blockService';
import { EnlargeableAvatar } from './EnlargeableAvatar';

interface BlockedUsersModalProps {
  currentUid: string;
  onClose: () => void;
  onSelectChatWithUser?: (uid: string) => void;
}

export const BlockedUsersModal: React.FC<BlockedUsersModalProps> = ({ 
  currentUid, 
  onClose,
  onSelectChatWithUser
}) => {
  const [blockedUsers, setBlockedUsers] = useState<LocalBlockedUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [unblockedToast, setUnblockedToast] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUid) return;
    const unsub = subscribeToBlockedUsers(currentUid, (list) => {
      setBlockedUsers(list);
    });
    return () => unsub();
  }, [currentUid]);

  const handleUnblock = (targetUid: string, name: string) => {
    unblockUserLocally(currentUid, targetUid);
    setUnblockedToast(`Unblocked @${name}`);
    setTimeout(() => setUnblockedToast(null), 2500);
  };

  const filtered = blockedUsers.filter(u => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.displayName?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.userTag?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Blocked Users</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Stored locally on your device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational Policy Box */}
        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/60 dark:border-amber-900/40 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300 shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[11px]">
            <strong>Local Block Policy:</strong> When you block a user, you will still receive their incoming messages, but you cannot send any messages to them until unblocked.
          </p>
        </div>

        {/* Search */}
        {blockedUsers.length > 3 && (
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blocked users..."
                className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          </div>
        )}

        {/* Toast Feedback */}
        {unblockedToast && (
          <div className="mx-6 mt-4 p-2.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-xs font-medium shrink-0 animate-in fade-in duration-150">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{unblockedToast}</span>
          </div>
        )}

        {/* Blocked Users List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {blockedUsers.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No Blocked Users</p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                You have not blocked any users on this device. You can block someone from the 1-on-1 chat header.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No blocked users matching "{searchQuery}"
            </div>
          ) : (
            filtered.map((user) => (
              <div
                key={user.uid}
                className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <EnlargeableAvatar
                    src={user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`}
                    alt={user.displayName || 'Blocked user'}
                    name={user.displayName || 'Blocked user'}
                    uid={user.uid}
                    sizeClass="w-10 h-10 rounded-xl"
                  />
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {user.displayName || 'User'}
                    </h4>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      @{user.username || 'user'}{user.userTag || ''}
                    </p>
                    <span className="text-[10px] text-rose-500 font-medium">Blocked</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onSelectChatWithUser && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChatWithUser(user.uid);
                        onClose();
                      }}
                      className="p-2 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      title="View Conversation"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleUnblock(user.uid, user.username || user.displayName || 'user')}
                    className="px-3 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all"
                  >
                    <Unlock className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Unblock</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Check, Clock, MessageSquare, ShieldCheck, User, ArrowLeft, Users2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserProfile, FriendRequest } from '../types';
import { searchUsers } from '../services/userService';
import { sendFriendRequest } from '../services/friendService';
import { getOrCreateChat } from '../services/chatService';

interface SearchUsersViewProps {
  friends: UserProfile[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  onSelectChat: (chatId: string) => void;
  onBackToChats?: () => void;
}

export const SearchUsersView: React.FC<SearchUsersViewProps> = ({
  friends,
  incomingRequests,
  outgoingRequests,
  onSelectChat,
  onBackToChats
}) => {
  const { userProfile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Auto-fetch suggested or matching users whenever term changes or component mounts
  useEffect(() => {
    let isMounted = true;
    const fetchUsers = async () => {
      if (!userProfile) return;
      setLoading(true);
      try {
        const res = await searchUsers(searchTerm, userProfile.uid);
        if (isMounted) setResults(res);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchUsers();
    return () => { isMounted = false; };
  }, [searchTerm, userProfile]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const getUserFriendStatus = (targetUid: string) => {
    const isFriend = friends.some(f => f.uid === targetUid);
    if (isFriend) return 'friend';

    const isOutgoing = outgoingRequests.some(r => r.toUid === targetUid && r.status === 'pending');
    if (isOutgoing) return 'pending_sent';

    const isIncoming = incomingRequests.some(r => r.fromUid === targetUid && r.status === 'pending');
    if (isIncoming) return 'pending_received';

    return 'none';
  };

  const handleSendRequest = async (targetUser: UserProfile) => {
    if (!userProfile) return;
    setSendingId(targetUser.uid);
    try {
      await sendFriendRequest(userProfile, targetUser);
    } catch (err) {
      console.error('Error sending friend request:', err);
    } finally {
      setSendingId(null);
    }
  };

  const handleStartChat = async (targetUid: string) => {
    if (!userProfile) return;
    try {
      const chatId = await getOrCreateChat(userProfile.uid, targetUid);
      onSelectChat(chatId);
    } catch (err) {
      console.error('Error opening chat:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-y-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1 text-left">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Search className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              Find & Add Friends
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Search users by <span className="font-mono text-blue-600 dark:text-blue-400">@username</span>, display name, tag e.g. <span className="font-mono text-blue-600 dark:text-blue-400">#1042</span>, or User ID
            </p>
          </div>

          {onBackToChats && (
            <button
              onClick={onBackToChats}
              className="md:hidden px-3 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
          )}
        </div>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="relative">
          <div className="relative flex items-center">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by @username, display name, tag #1042, or ID..."
              className="w-full pl-12 pr-28 py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white transition-all"
            />
            <button
              type="submit"
              className="absolute right-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-xs shadow-md shadow-blue-600/20 transition-all"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {/* Results / Suggested List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-medium">
            <span>{searchTerm.trim() ? `Search Results (${results.length})` : `Suggested Friends (${results.length})`}</span>
          </div>

          {results.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-800/50 rounded-3xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
              <User className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No users found</p>
              <p className="text-xs text-slate-400">Double check the username or handle and try again.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {results.map((user) => {
                  const status = getUserFriendStatus(user.uid);
                  const isSending = sendingId === user.uid;

                  return (
                    <div
                      key={user.uid}
                      className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4 shadow-xs hover:border-blue-300 dark:hover:border-blue-800 transition-all"
                    >
                      {/* Left User info */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={user.photoURL}
                          alt={user.displayName}
                          className="w-12 h-12 rounded-2xl object-cover bg-blue-50 shrink-0 ring-2 ring-slate-100 dark:ring-slate-700"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                              {user.displayName}
                            </span>
                            <span className="text-xs font-mono text-blue-600 dark:text-blue-400 shrink-0 font-semibold">
                              @{user.username}{user.userTag}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400 border border-slate-200/80 dark:border-slate-600 shrink-0" title="User ID">
                              ID: {user.uid}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {user.bio || 'Connexa user'}
                          </p>
                        </div>
                      </div>

                      {/* Right Action buttons */}
                      <div className="shrink-0">
                        {status === 'friend' && (
                          <div className="flex items-center gap-2">
                            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg border border-emerald-200/60 dark:border-emerald-900">
                              <ShieldCheck className="w-3.5 h-3.5" /> Friends
                            </span>
                            <button
                              onClick={() => handleStartChat(user.uid)}
                              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              <span>Chat</span>
                            </button>
                          </div>
                        )}

                        {status === 'pending_sent' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-semibold">
                            <Clock className="w-3.5 h-3.5 animate-pulse" /> Pending Request
                          </span>
                        )}

                        {status === 'pending_received' && (
                          <span className="inline-flex items-center gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-semibold">
                            Check Incoming Requests
                          </span>
                        )}

                        {status === 'none' && (
                          <button
                            onClick={() => handleSendRequest(user)}
                            disabled={isSending}
                            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-xs"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>{isSending ? 'Sending...' : 'Add Friend'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
          )}
        </div>

        {/* Security Banner Info */}
        <div className="p-5 bg-linear-to-br from-blue-50 to-slate-100 dark:from-slate-800/50 dark:to-slate-800/20 rounded-2xl border border-blue-100/80 dark:border-slate-700/80 space-y-2">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-bold text-xs">
            <ShieldCheck className="w-4 h-4" />
            <span>Friend-First Messaging Security</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Connexa only allows direct messaging between accepted friends to prevent spam. Send a friend request to anyone above to start chatting as soon as they accept!
          </p>
        </div>
      </div>
    </div>
  );
};

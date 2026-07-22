import React, { useState } from 'react';
import { UserCheck, UserX, Clock, MessageSquare, Trash2, Users, Inbox, SendHorizontal, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FriendRequest, UserProfile } from '../types';
import { acceptFriendRequest, rejectOrCancelFriendRequest, removeFriend } from '../services/friendService';
import { getOrCreateChat } from '../services/chatService';

interface FriendRequestsViewProps {
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  friends: UserProfile[];
  onSelectChat: (chatId: string) => void;
  onBackToChats?: () => void;
}

export const FriendRequestsView: React.FC<FriendRequestsViewProps> = ({
  incomingRequests,
  outgoingRequests,
  friends,
  onSelectChat,
  onBackToChats
}) => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'friends' | 'incoming' | 'outgoing'>('friends');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleAccept = async (request: FriendRequest) => {
    setProcessingId(request.id);
    try {
      await acceptFriendRequest(request);
    } catch (err) {
      console.error('Error accepting friend request:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectOrCancel = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      await rejectOrCancelFriendRequest(requestId);
    } catch (err) {
      console.error('Error rejecting request:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemoveFriend = async (targetUid: string) => {
    if (!userProfile) return;
    if (!confirm('Are you sure you want to remove this friend?')) return;
    try {
      await removeFriend(userProfile.uid, targetUid);
    } catch (err) {
      console.error('Error removing friend:', err);
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
        
        {/* Title & Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full sm:w-auto gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Friends & Connections
              </h2>
              <p className="text-xs text-slate-500">Manage your friends, incoming requests, and pending invites</p>
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

          <div className="flex bg-slate-200/80 dark:bg-slate-800 p-1 rounded-2xl text-xs font-semibold self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('friends')}
              className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'friends'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Friends ({friends.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('incoming')}
              className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 relative ${
                activeTab === 'incoming'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Requests</span>
              {incomingRequests.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 bg-red-500 text-white rounded-full text-[10px] font-bold">
                  {incomingRequests.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('outgoing')}
              className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'outgoing'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              <span>Sent ({outgoingRequests.length})</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Friends List */}
        {activeTab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-slate-800/50 rounded-3xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
                <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No friends added yet</p>
                <p className="text-xs text-slate-400">Search users using the search tab and send friend requests!</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {friends.map((friend) => (
                  <div
                    key={friend.uid}
                    className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4 shadow-xs hover:border-blue-200 dark:hover:border-blue-800 transition-all"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={friend.photoURL}
                          alt={friend.displayName}
                          className="w-12 h-12 rounded-2xl object-cover bg-blue-50 ring-2 ring-slate-100 dark:ring-slate-700"
                        />
                        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 ring-2 ring-white dark:ring-slate-800 rounded-full" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {friend.displayName}
                          </span>
                          <span className="text-xs font-mono text-blue-600 dark:text-blue-400 shrink-0 font-medium">
                            @{friend.username}{friend.userTag}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {friend.bio || 'Connected on Connexa'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleStartChat(friend.uid)}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Chat</span>
                      </button>
                      <button
                        onClick={() => handleRemoveFriend(friend.uid)}
                        title="Remove Friend"
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Incoming Requests */}
        {activeTab === 'incoming' && (
          <div className="space-y-3">
            {incomingRequests.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-slate-800/50 rounded-3xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
                <Inbox className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No incoming friend requests</p>
                <p className="text-xs text-slate-400">When someone adds you, their request will appear here.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {incomingRequests.map((req) => {
                  const isProcessing = processingId === req.id;
                  return (
                    <div
                      key={req.id}
                      className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between gap-4 shadow-xs"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={req.fromPhotoURL}
                          alt={req.fromDisplayName}
                          className="w-12 h-12 rounded-2xl object-cover bg-indigo-50 shrink-0 ring-2 ring-indigo-500/20"
                        />
                        <div className="min-w-0">
                          <span className="font-bold text-sm text-slate-900 dark:text-white truncate block">
                            {req.fromDisplayName}
                          </span>
                          <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium block">
                            @{req.fromUsername}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleAccept(req)}
                          disabled={isProcessing}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Accept</span>
                        </button>
                        <button
                          onClick={() => handleRejectOrCancel(req.id)}
                          disabled={isProcessing}
                          className="px-3.5 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-medium rounded-xl text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Outgoing Requests */}
        {activeTab === 'outgoing' && (
          <div className="space-y-3">
            {outgoingRequests.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-slate-800/50 rounded-3xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
                <SendHorizontal className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No pending sent requests</p>
                <p className="text-xs text-slate-400">Search users to invite friends to Connexa.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {outgoingRequests.map((req) => {
                  const isProcessing = processingId === req.id;
                  return (
                    <div
                      key={req.id}
                      className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4 shadow-xs"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-slate-700 flex items-center justify-center shrink-0">
                          <Clock className="w-5 h-5 text-indigo-500 animate-spin" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-sm text-slate-900 dark:text-white truncate block font-mono">
                            @{req.toUsername}
                          </span>
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                            Waiting for acceptance...
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRejectOrCancel(req.id)}
                        disabled={isProcessing}
                        className="px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Cancel Request
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

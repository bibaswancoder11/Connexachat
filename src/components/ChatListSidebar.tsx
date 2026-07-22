import React, { useState } from 'react';
import { MessageSquare, Search, Users, UserPlus, Sparkles, PlusCircle, Users2 } from 'lucide-react';
import { ChatRoom, UserProfile } from '../types';
import { useAuth } from '../context/AuthContext';

interface ChatListSidebarProps {
  chats: ChatRoom[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNavigateTab: (tab: 'chats' | 'search' | 'requests') => void;
  activeTab: 'chats' | 'search' | 'requests';
  unreadRequestsCount: number;
  onCreateGroupClick: () => void;
}

export const ChatListSidebar: React.FC<ChatListSidebarProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  onNavigateTab,
  activeTab,
  unreadRequestsCount,
  onCreateGroupClick
}) => {
  const { userProfile } = useAuth();
  const [filterText, setFilterText] = useState('');

  const filteredChats = chats.filter(chat => {
    if (!filterText.trim()) return true;
    const term = filterText.toLowerCase();

    if (chat.isGroup) {
      const groupNameMatch = chat.groupName?.toLowerCase().includes(term);
      const memberMatch = Object.values(chat.participantProfiles || {}).some(
        (p: UserProfile) => p.displayName.toLowerCase().includes(term) || p.username.toLowerCase().includes(term)
      );
      return groupNameMatch || memberMatch;
    } else {
      const nameMatch = chat.otherUser?.displayName?.toLowerCase().includes(term);
      const usernameMatch = chat.otherUser?.username?.toLowerCase().includes(term);
      return nameMatch || usernameMatch;
    }
  });

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-full md:w-80 lg:w-96 shrink-0 h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      
      {/* Top Controls: Search Filter & Create Group */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
        
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter chats..."
              className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700/50 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
            />
          </div>

          <button
            onClick={onCreateGroupClick}
            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5 shrink-0 px-3 text-xs font-semibold"
            title="Create New Group Chat"
          >
            <PlusCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Group</span>
          </button>
        </div>

        {/* Action Tabs: All Chats | Search Users | Friend Requests */}
        <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => onNavigateTab('chats')}
            className={`py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
              activeTab === 'chats'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chats</span>
          </button>

          <button
            onClick={() => onNavigateTab('search')}
            className={`py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
              activeTab === 'search'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>

          <button
            onClick={() => onNavigateTab('requests')}
            className={`py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 relative ${
              activeTab === 'requests'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Friends</span>
            {unreadRequestsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 absolute top-1 right-1" />
            )}
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
        {filteredChats.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center mx-auto text-blue-500">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No active chats</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Start a 1-on-1 chat or create a group chat with friends!
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => onNavigateTab('search')}
                className="px-3.5 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs"
              >
                Find Friends
              </button>
              <button
                onClick={onCreateGroupClick}
                className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
              >
                New Group
              </button>
            </div>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isActive = activeChatId === chat.id && activeTab === 'chats';
            const unreadCount = userProfile ? (chat.unreadCounts?.[userProfile.uid] || 0) : 0;
            
            const title = chat.isGroup
              ? chat.groupName || 'Group Chat'
              : chat.otherUser?.displayName || 'Friend';

            const avatarUrl = chat.isGroup
              ? (chat.groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${chat.id}`)
              : (chat.otherUser?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.id}`);

            const memberCount = chat.participants?.length || 0;

            return (
              <button
                key={chat.id}
                onClick={() => {
                  onSelectChat(chat.id);
                  onNavigateTab('chats');
                }}
                className={`w-full p-4 flex items-center gap-3.5 text-left transition-all relative ${
                  isActive
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 border-l-4 border-blue-600 dark:border-blue-400'
                    : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                }`}
              >
                {/* Avatar with Badge */}
                <div className="relative shrink-0">
                  <img
                    src={avatarUrl}
                    alt={title}
                    className="w-12 h-12 rounded-2xl object-cover bg-blue-50 dark:bg-slate-800 ring-2 ring-slate-100 dark:ring-slate-800"
                  />
                  {chat.isGroup ? (
                    <span className="absolute -bottom-1 -right-1 px-1 py-0.5 bg-blue-600 text-white text-[9px] font-bold rounded-md ring-2 ring-white dark:ring-slate-900 flex items-center gap-0.5">
                      <Users2 className="w-2.5 h-2.5" />
                      {memberCount}
                    </span>
                  ) : (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 ring-2 ring-white dark:ring-slate-900 rounded-full" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {title}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                      {formatTimestamp(chat.lastMessageTime)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs truncate ${unreadCount > 0 ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                      {chat.lastMessage || 'No messages yet...'}
                    </p>

                    {unreadCount > 0 && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-blue-600 text-white font-bold rounded-full text-[10px]">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};


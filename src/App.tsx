import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { NavigationHeader } from './components/NavigationHeader';
import { ChatListSidebar } from './components/ChatListSidebar';
import { ChatView } from './components/ChatView';
import { SearchUsersView } from './components/SearchUsersView';
import { FriendRequestsView } from './components/FriendRequestsView';
import { CreateGroupModal } from './components/CreateGroupModal';
import { ChatRoom, FriendRequest, UserProfile } from './types';
import { subscribeToUserChats } from './services/chatService';
import { subscribeToIncomingRequests, subscribeToOutgoingRequests, subscribeToFriends } from './services/friendService';
import { requestNotificationPermission, sendWebNotification, playNotificationChime } from './services/notificationService';
import { MessageSquare, Users, UserPlus, PlusCircle } from 'lucide-react';

const ConnexaApp: React.FC = () => {
  const { currentUser, userProfile, loading } = useAuth();

  const [activeTab, setActiveTab] = useState<'chats' | 'search' | 'requests'>('chats');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [chats, setChats] = useState<ChatRoom[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  // Keep track of previous chat messages & request counts to trigger notifications
  const prevChatsRef = useRef<ChatRoom[]>([]);
  const prevRequestsCountRef = useRef<number>(0);
  const isFirstLoadRef = useRef<boolean>(true);

  // Ask for Push Notification permission on load
  useEffect(() => {
    if (currentUser) {
      requestNotificationPermission();
    }
  }, [currentUser]);

  // Subscriptions when user is logged in
  useEffect(() => {
    if (!currentUser || !userProfile) return;

    // Real-time chats subscription
    const unsubscribeChats = subscribeToUserChats(currentUser.uid, (chatList) => {
      // Check for new messages to trigger push notification
      if (!isFirstLoadRef.current) {
        chatList.forEach((chat) => {
          const prevChat = prevChatsRef.current.find(c => c.id === chat.id);
          const unread = chat.unreadCounts?.[currentUser.uid] || 0;
          const prevUnread = prevChat?.unreadCounts?.[currentUser.uid] || 0;

          if (unread > prevUnread && chat.lastMessageSenderId !== currentUser.uid) {
            const senderName = chat.isGroup 
              ? (chat.groupName || 'Group Chat') 
              : (chat.otherUser?.displayName || 'Friend');

            sendWebNotification(
              chat.isGroup ? `New message in ${chat.groupName}` : `New message from ${senderName}`,
              chat.lastMessage || 'Sent a message',
              chat.isGroup ? chat.groupAvatar : chat.otherUser?.photoURL
            );
            playNotificationChime(chat.isGroup ? 'group' : 'message');
          }
        });
      }

      prevChatsRef.current = chatList;
      setChats(chatList);

      if (!activeChatId && chatList.length > 0) {
        setActiveChatId(chatList[0].id);
      }

      isFirstLoadRef.current = false;
    });

    // Incoming friend requests subscription
    const unsubscribeIncoming = subscribeToIncomingRequests(currentUser.uid, (requests) => {
      const pendingReqs = requests.filter(r => r.status === 'pending');
      
      if (!isFirstLoadRef.current && pendingReqs.length > prevRequestsCountRef.current) {
        const latest = pendingReqs[0];
        sendWebNotification(
          'New Friend Request 🤝',
          `${latest.fromDisplayName || 'Someone'} sent you a friend request on Connexa!`,
          latest.fromPhotoURL
        );
        playNotificationChime('request');
      }

      prevRequestsCountRef.current = pendingReqs.length;
      setIncomingRequests(pendingReqs);
    });

    // Outgoing friend requests subscription
    const unsubscribeOutgoing = subscribeToOutgoingRequests(currentUser.uid, (requests) => {
      setOutgoingRequests(requests.filter(r => r.status === 'pending'));
    });

    // Friends list subscription
    const unsubscribeFriendsList = subscribeToFriends(currentUser.uid, (friendProfiles) => {
      setFriends(friendProfiles);
    });

    return () => {
      unsubscribeChats();
      unsubscribeIncoming();
      unsubscribeOutgoing();
      unsubscribeFriendsList();
    };
  }, [currentUser, userProfile]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="p-4 bg-blue-600/20 rounded-3xl border border-blue-500/30 mb-4 animate-bounce">
          <MessageSquare className="w-10 h-10 text-blue-400" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Connexa</h2>
        <p className="text-xs text-slate-400 mt-1">Initializing secure messenger...</p>
      </div>
    );
  }

  if (!currentUser || !userProfile) {
    return <AuthModal />;
  }

  const activeChat = chats.find(c => c.id === activeChatId);

  return (
    <div className="flex flex-col h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
      
      {/* Top Navigation */}
      <NavigationHeader
        activeTab={activeTab}
        onNavigateTab={setActiveTab}
        unreadRequestsCount={incomingRequests.length}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar - Chat List & Controls */}
        <div className={`${
          activeTab === 'chats' && !activeChatId ? 'flex w-full md:w-80 lg:w-96' : 'hidden md:flex md:w-80 lg:w-96'
        } shrink-0 h-full flex-col`}>
          <ChatListSidebar
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={(id) => {
              setActiveChatId(id);
              setActiveTab('chats');
            }}
            onNavigateTab={setActiveTab}
            activeTab={activeTab}
            unreadRequestsCount={incomingRequests.length}
            onCreateGroupClick={() => setShowCreateGroupModal(true)}
          />
        </div>

        {/* Main Content Pane depending on Active Tab */}
        <div className={`${
          activeTab === 'chats' && !activeChatId ? 'hidden md:flex' : 'flex'
        } flex-1 flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-900`}>
          {activeTab === 'chats' && (
            activeChat ? (
              <ChatView
                chat={activeChat}
                friends={friends}
                onGroupLeft={() => {
                  setActiveChatId(null);
                }}
                onBackToChats={() => {
                  setActiveChatId(null);
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="p-5 bg-blue-100 dark:bg-slate-800 rounded-3xl text-blue-600 dark:text-blue-400 shadow-xs">
                  <MessageSquare className="w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                    Select a conversation or create a group
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Connexa lets you chat 1-on-1 with friends or create group chats with multiple friends!
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateGroupModal(true)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs flex items-center gap-2 shadow-md shadow-blue-600/20 transition-all"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Create Group Chat</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('search')}
                    className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold rounded-xl text-xs flex items-center gap-2 transition-all"
                  >
                    <UserPlus className="w-4 h-4 text-blue-500" />
                    <span>Find Friends</span>
                  </button>
                </div>
              </div>
            )
          )}

          {activeTab === 'search' && (
            <SearchUsersView
              friends={friends}
              incomingRequests={incomingRequests}
              outgoingRequests={outgoingRequests}
              onSelectChat={(chatId) => {
                setActiveChatId(chatId);
                setActiveTab('chats');
              }}
              onBackToChats={() => {
                setActiveTab('chats');
                setActiveChatId(null);
              }}
            />
          )}

          {activeTab === 'requests' && (
            <FriendRequestsView
              incomingRequests={incomingRequests}
              outgoingRequests={outgoingRequests}
              friends={friends}
              onSelectChat={(chatId) => {
                setActiveChatId(chatId);
                setActiveTab('chats');
              }}
              onBackToChats={() => {
                setActiveTab('chats');
                setActiveChatId(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <CreateGroupModal
          currentUserProfile={userProfile}
          friends={friends}
          onClose={() => setShowCreateGroupModal(false)}
          onGroupCreated={(newChatId) => {
            setActiveChatId(newChatId);
            setActiveTab('chats');
          }}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ConnexaApp />
    </AuthProvider>
  );
}


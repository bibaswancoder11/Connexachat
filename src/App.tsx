import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AvatarPreviewProvider } from './context/AvatarPreviewContext';
import { AuthModal } from './components/AuthModal';
import { NavigationHeader } from './components/NavigationHeader';
import { ChatListSidebar } from './components/ChatListSidebar';
import { ChatView } from './components/ChatView';
import { SearchUsersView } from './components/SearchUsersView';
import { FriendRequestsView } from './components/FriendRequestsView';
import { CreateGroupModal } from './components/CreateGroupModal';
import { NotificationToast, ToastNotificationData } from './components/NotificationToast';
import { ChatRoom, FriendRequest, UserProfile } from './types';
import { subscribeToUserChats, getOrCreateChat } from './services/chatService';
import { subscribeToIncomingRequests, subscribeToOutgoingRequests, subscribeToFriends } from './services/friendService';
import { requestNotificationPermission, sendWebNotification, playNotificationChime, initServiceWorker } from './services/notificationService';
import { MessageSquare, Users, UserPlus, PlusCircle } from 'lucide-react';
import { ConnexaLogo } from './components/ConnexaLogo';

const ConnexaApp: React.FC = () => {
  const { currentUser, userProfile, loading } = useAuth();

  const [activeTab, setActiveTab] = useState<'chats' | 'search' | 'requests'>('chats');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [chats, setChats] = useState<ChatRoom[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [toastNotification, setToastNotification] = useState<ToastNotificationData | null>(null);

  // Keep track of previous states and notified IDs to trigger notifications reliably without duplicates
  const prevChatsMapRef = useRef<Map<string, ChatRoom>>(new Map());
  const isFirstChatsLoadRef = useRef<boolean>(true);
  const notifiedMessageKeysRef = useRef<Set<string>>(new Set());

  const knownOutgoingUidsRef = useRef<Set<string>>(new Set());
  const knownFriendUidsRef = useRef<Set<string> | null>(null);
  const knownIncomingReqIdsRef = useRef<Set<string> | null>(null);

  // Ask for Push Notification permission & register Service Worker on load
  useEffect(() => {
    if (currentUser) {
      requestNotificationPermission();
      initServiceWorker();
      try {
        localStorage.setItem('connexa_last_uid', currentUser.uid);
      } catch (e) {
        // ignore
      }

      // Handle notification clicks forwarded from Service Worker
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const handleSwMessage = (event: MessageEvent) => {
          if (event.data?.type === 'NOTIFICATION_CLICK') {
            const payload = event.data.payload;
            if (payload?.chatId) {
              setActiveChatId(payload.chatId);
              setActiveTab('chats');
            } else if (payload?.tab) {
              setActiveTab(payload.tab);
            }
          }
        };

        navigator.serviceWorker.addEventListener('message', handleSwMessage);
        return () => {
          navigator.serviceWorker.removeEventListener('message', handleSwMessage);
        };
      }
    }
  }, [currentUser]);

  // Update Browser Document Title badge with unread messages + requests count
  useEffect(() => {
    if (!currentUser) {
      document.title = 'Connexa Messenger';
      return;
    }

    const totalUnreadChats = chats.reduce((sum, chat) => {
      const count = chat.unreadCounts?.[currentUser.uid] || 0;
      return sum + count;
    }, 0);

    const totalUnread = totalUnreadChats + incomingRequests.length;

    if (totalUnread > 0) {
      document.title = `(${totalUnread}) Connexa Messenger`;
    } else {
      document.title = 'Connexa Messenger';
    }
  }, [chats, incomingRequests, currentUser]);

  // Subscriptions when user is logged in
  useEffect(() => {
    if (!currentUser || !userProfile) return;

    // 1. Real-time chats subscription & new incoming message notifications
    const unsubscribeChats = subscribeToUserChats(currentUser.uid, (chatList) => {
      if (isFirstChatsLoadRef.current) {
        // Seed initial chat state without triggering stale notifications on first load
        chatList.forEach((chat) => {
          prevChatsMapRef.current.set(chat.id, chat);
          if (chat.lastMessageSenderId && chat.lastMessage) {
            const timeVal = chat.lastMessageTime?.toMillis ? chat.lastMessageTime.toMillis() : (chat.lastMessageTime?.seconds ? chat.lastMessageTime.seconds * 1000 : 0);
            notifiedMessageKeysRef.current.add(`${chat.id}_${chat.lastMessageSenderId}_${timeVal}_${chat.lastMessage}`);
          }
        });
        isFirstChatsLoadRef.current = false;
      } else {
        // Check for new messages arriving in real time
        chatList.forEach((chat) => {
          const prevChat = prevChatsMapRef.current.get(chat.id);
          const unread = chat.unreadCounts?.[currentUser.uid] || 0;
          const prevUnread = prevChat?.unreadCounts?.[currentUser.uid] || 0;

          const hasLastMessage = Boolean(chat.lastMessage && chat.lastMessageSenderId);
          const isFromOtherUser = chat.lastMessageSenderId !== currentUser.uid;

          if (hasLastMessage && isFromOtherUser) {
            const timeVal = chat.lastMessageTime?.toMillis 
              ? chat.lastMessageTime.toMillis() 
              : (chat.lastMessageTime?.seconds 
                  ? chat.lastMessageTime.seconds * 1000 
                  : (chat.updatedAt?.toMillis ? chat.updatedAt.toMillis() : Date.now()));

            const msgKey = `${chat.id}_${chat.lastMessageSenderId}_${timeVal}_${chat.lastMessage}`;

            const isNewContent = !prevChat || prevChat.lastMessage !== chat.lastMessage || unread > prevUnread || prevChat.lastMessageSenderId !== chat.lastMessageSenderId;

            if (isNewContent && !notifiedMessageKeysRef.current.has(msgKey)) {
              notifiedMessageKeysRef.current.add(msgKey);

              // Check if user is currently looking at this active chat with window in focus
              const isViewingActiveChat = activeChatId === chat.id && activeTab === 'chats' && typeof document !== 'undefined' && !document.hidden;

              if (!isViewingActiveChat) {
                const senderName = chat.isGroup 
                  ? (chat.groupName || 'Group Chat') 
                  : (chat.otherUser?.displayName || 'Friend');

                const avatar = chat.isGroup ? chat.groupAvatar : chat.otherUser?.photoURL;
                const notifTitle = chat.isGroup ? `💬 ${chat.groupName}` : `💬 ${senderName}`;
                const notifBody = chat.lastMessage || 'Sent a new message';

                // Send System Web / Service Worker Notification
                sendWebNotification(notifTitle, notifBody, avatar, () => {
                  setActiveChatId(chat.id);
                  setActiveTab('chats');
                });

                // Play audio chime
                playNotificationChime(chat.isGroup ? 'group' : 'message');

                // Trigger floating In-App Toast
                setToastNotification({
                  id: `${chat.id}_${Date.now()}`,
                  type: 'message',
                  title: notifTitle,
                  body: notifBody,
                  avatar: avatar,
                  chatId: chat.id,
                  actionLabel: 'Open Chat',
                  onAction: () => {
                    setActiveChatId(chat.id);
                    setActiveTab('chats');
                  }
                });
              }
            }
          }

          prevChatsMapRef.current.set(chat.id, chat);
        });
      }

      setChats(chatList);

      if (!activeChatId && chatList.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
        setActiveChatId(chatList[0].id);
      }
    });

    // 2. Incoming friend requests subscription
    const unsubscribeIncoming = subscribeToIncomingRequests(currentUser.uid, (requests) => {
      const pendingReqs = requests.filter(r => r.status === 'pending');
      const currentReqIds = new Set(pendingReqs.map(r => r.id));

      if (knownIncomingReqIdsRef.current !== null) {
        // Find newly arrived incoming requests
        const newlyArrived = pendingReqs.filter(r => !knownIncomingReqIdsRef.current?.has(r.id));
        if (newlyArrived.length > 0) {
          const latest = newlyArrived[0];
          const reqTitle = 'New Friend Request 🤝';
          const reqBody = `${latest.fromDisplayName || 'Someone'} sent you a friend request on Connexa!`;

          // Send System Web / Service Worker Notification
          sendWebNotification(reqTitle, reqBody, latest.fromPhotoURL, () => {
            setActiveTab('requests');
          });

          // Play audio chime
          playNotificationChime('request');

          // Trigger floating In-App Toast
          setToastNotification({
            id: `req_${latest.id}_${Date.now()}`,
            type: 'request',
            title: reqTitle,
            body: reqBody,
            avatar: latest.fromPhotoURL,
            actionLabel: 'View Requests',
            onAction: () => {
              setActiveTab('requests');
            }
          });
        }
      }

      knownIncomingReqIdsRef.current = currentReqIds;
      setIncomingRequests(pendingReqs);
    });

    // 3. Outgoing friend requests subscription
    const unsubscribeOutgoing = subscribeToOutgoingRequests(currentUser.uid, (requests) => {
      const pending = requests.filter(r => r.status === 'pending');
      knownOutgoingUidsRef.current = new Set(pending.map(r => r.toUid));
      setOutgoingRequests(pending);
    });

    // 4. Friends list subscription & Friend Request Acceptance notifications
    const unsubscribeFriendsList = subscribeToFriends(currentUser.uid, (friendProfiles) => {
      const currentFriendUids = new Set(friendProfiles.map(p => p.uid));

      if (knownFriendUidsRef.current !== null) {
        // Detect newly added friends (e.g. someone accepted a friend request I sent)
        const newlyAddedFriends = friendProfiles.filter(p => !knownFriendUidsRef.current?.has(p.uid));

        newlyAddedFriends.forEach((newFriend) => {
          const notifTitle = 'Friend Request Accepted! 🎉';
          const notifBody = `${newFriend.displayName} (@${newFriend.username}) accepted your friend request! You can now start chatting.`;

          // Send System Web / Service Worker Notification
          sendWebNotification(notifTitle, notifBody, newFriend.photoURL, () => {
            handleDirectChat(newFriend.uid);
          });

          // Play celebratory sound chime
          playNotificationChime('accepted');

          // Trigger floating In-App Toast
          setToastNotification({
            id: `accepted_${newFriend.uid}_${Date.now()}`,
            type: 'friend_accepted',
            title: notifTitle,
            body: `${newFriend.displayName} accepted your friend request!`,
            avatar: newFriend.photoURL,
            actionLabel: 'Start Chatting',
            onAction: () => {
              handleDirectChat(newFriend.uid);
            }
          });
        });
      }

      knownFriendUidsRef.current = currentFriendUids;
      setFriends(friendProfiles);
    });

    return () => {
      unsubscribeChats();
      unsubscribeIncoming();
      unsubscribeOutgoing();
      unsubscribeFriendsList();
    };
  }, [currentUser, userProfile, activeChatId, activeTab]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="mb-4 animate-bounce">
          <ConnexaLogo size={64} className="ring-4 ring-blue-500/20 rounded-2xl shadow-xl" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Connexa</h2>
        <p className="text-xs text-slate-400 mt-1">Initializing secure messenger...</p>
      </div>
    );
  }

  if (!currentUser || !userProfile) {
    return <AuthModal />;
  }

  const handleDirectChat = async (targetUid: string) => {
    if (!userProfile) return;
    try {
      const chatId = await getOrCreateChat(userProfile.uid, targetUid);
      setActiveChatId(chatId);
      setActiveTab('chats');
    } catch (err) {
      console.error('Failed to open chat with user:', err);
    }
  };

  const activeChat = chats.find(c => c.id === activeChatId);

  return (
    <AvatarPreviewProvider onOpenDirectChat={handleDirectChat}>
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

        {/* Real-time In-App Floating Toast Notification Banner */}
        <NotificationToast
          toast={toastNotification}
          onClose={() => setToastNotification(null)}
        />
      </div>
    </AvatarPreviewProvider>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ConnexaApp />
    </AuthProvider>
  );
}


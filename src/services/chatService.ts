import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  deleteDoc, 
  increment,
  arrayUnion,
  arrayRemove,
  getDocs,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { ChatRoom, ChatMessage, UserProfile } from '../types';
import { getFriendshipId } from './friendService';
import { getUserProfile } from './userService';

export const getOrCreateChat = async (uid1: string, uid2: string): Promise<string> => {
  const chatId = getFriendshipId(uid1, uid2);
  const chatRef = doc(db, 'chats', chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    const participants = [uid1, uid2].sort();
    const newChat: ChatRoom = {
      id: chatId,
      participants,
      isGroup: false,
      lastMessage: '',
      lastMessageSenderId: '',
      lastMessageTime: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadCounts: {
        [uid1]: 0,
        [uid2]: 0
      },
      typing: {
        [uid1]: false,
        [uid2]: false
      }
    };
    await setDoc(chatRef, newChat);
  }

  return chatId;
};

export const createGroupChat = async (
  groupName: string,
  groupAvatar: string,
  creatorProfile: UserProfile,
  initialMemberUids: string[]
): Promise<string> => {
  const chatsRef = collection(db, 'chats');
  const newChatDocRef = doc(chatsRef);
  const chatId = newChatDocRef.id;

  const allMembers = Array.from(new Set([creatorProfile.uid, ...initialMemberUids]));

  const initialUnreadCounts: { [uid: string]: number } = {};
  const initialTyping: { [uid: string]: boolean } = {};

  allMembers.forEach(uid => {
    initialUnreadCounts[uid] = uid === creatorProfile.uid ? 0 : 1;
    initialTyping[uid] = false;
  });

  const avatarUrl = groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(groupName)}`;

  const newGroupChat: ChatRoom = {
    id: chatId,
    isGroup: true,
    groupName,
    groupAvatar: avatarUrl,
    participants: allMembers,
    adminUids: [creatorProfile.uid],
    createdBy: creatorProfile.uid,
    lastMessage: `🎉 ${creatorProfile.displayName} created group "${groupName}"`,
    lastMessageSenderId: creatorProfile.uid,
    lastMessageTime: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadCounts: initialUnreadCounts,
    typing: initialTyping
  };

  await setDoc(newChatDocRef, newGroupChat);

  // Add initial system message
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  await addDoc(messagesRef, {
    chatId,
    senderId: creatorProfile.uid,
    senderName: creatorProfile.displayName,
    text: `🎉 ${creatorProfile.displayName} created group "${groupName}"`,
    type: 'system',
    timestamp: serverTimestamp(),
    readBy: [creatorProfile.uid]
  });

  return chatId;
};

export const addMembersToGroup = async (
  chatId: string,
  adderProfile: UserProfile,
  newMembers: UserProfile[]
): Promise<void> => {
  const chatRef = doc(db, 'chats', chatId);
  const newUids = newMembers.map(m => m.uid);

  const unreadUpdates: { [key: string]: any } = {};
  const typingUpdates: { [key: string]: any } = {};

  newUids.forEach(uid => {
    unreadUpdates[`unreadCounts.${uid}`] = 1;
    typingUpdates[`typing.${uid}`] = false;
  });

  const addedNames = newMembers.map(m => m.displayName).join(', ');

  await updateDoc(chatRef, {
    participants: arrayUnion(...newUids),
    lastMessage: `👥 ${adderProfile.displayName} added ${addedNames}`,
    lastMessageSenderId: adderProfile.uid,
    lastMessageTime: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...unreadUpdates,
    ...typingUpdates
  });

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  await addDoc(messagesRef, {
    chatId,
    senderId: adderProfile.uid,
    senderName: adderProfile.displayName,
    text: `👥 ${adderProfile.displayName} added ${addedNames} to the group`,
    type: 'system',
    timestamp: serverTimestamp(),
    readBy: [adderProfile.uid]
  });
};

export const leaveGroup = async (
  chatId: string,
  userProfile: UserProfile
): Promise<void> => {
  const chatRef = doc(db, 'chats', chatId);

  await updateDoc(chatRef, {
    participants: arrayRemove(userProfile.uid),
    adminUids: arrayRemove(userProfile.uid),
    lastMessage: `🚪 ${userProfile.displayName} left the group`,
    lastMessageSenderId: userProfile.uid,
    lastMessageTime: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  await addDoc(messagesRef, {
    chatId,
    senderId: userProfile.uid,
    senderName: userProfile.displayName,
    text: `🚪 ${userProfile.displayName} left the group`,
    type: 'system',
    timestamp: serverTimestamp(),
    readBy: []
  });
};

export const updateGroupDetails = async (
  chatId: string,
  updaterProfile: UserProfile,
  groupName: string,
  groupAvatar: string
): Promise<void> => {
  const chatRef = doc(db, 'chats', chatId);

  await updateDoc(chatRef, {
    groupName,
    groupAvatar,
    lastMessage: `✏️ ${updaterProfile.displayName} updated group info`,
    updatedAt: serverTimestamp()
  });

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  await addDoc(messagesRef, {
    chatId,
    senderId: updaterProfile.uid,
    senderName: updaterProfile.displayName,
    text: `✏️ ${updaterProfile.displayName} updated group info`,
    type: 'system',
    timestamp: serverTimestamp(),
    readBy: [updaterProfile.uid]
  });
};

export const subscribeToUserChats = (
  currentUid: string, 
  callback: (chats: ChatRoom[]) => void
) => {
  const q = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', currentUid)
  );

  return onSnapshot(
    q, 
    async (snapshot) => {
      const chatDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as ChatRoom);
      
      // Sort client-side by updatedAt descending
      chatDocs.sort((a, b) => {
        const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.updatedAt || 0);
        const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.updatedAt || 0);
        return timeB - timeA;
      });

      // Populate otherUser profile for 1-on-1 AND participantProfiles for groups
      const populatedChats = await Promise.all(
        chatDocs.map(async (chat) => {
          if (!chat.isGroup) {
            const otherUid = chat.participants.find(u => u !== currentUid);
            let otherUser: UserProfile | undefined = undefined;
            if (otherUid) {
              otherUser = (await getUserProfile(otherUid)) || undefined;
            }
            return {
              ...chat,
              otherUser
            };
          } else {
            // Fetch profiles of all members in group
            const profiles: { [uid: string]: UserProfile } = {};
            await Promise.all(
              chat.participants.map(async (uid) => {
                const p = await getUserProfile(uid);
                if (p) profiles[uid] = p;
              })
            );
            return {
              ...chat,
              participantProfiles: profiles
            };
          }
        })
      );

      callback(populatedChats);
    },
    (err) => {
      console.warn('Error listening to user chats:', err);
    }
  );
};

export const subscribeToMessages = (
  chatId: string, 
  callback: (messages: ChatMessage[]) => void
) => {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  return onSnapshot(
    q, 
    (snapshot) => {
      const messages: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        messages.push({ id: docSnap.id, ...docSnap.data() } as ChatMessage);
      });
      callback(messages);
    },
    (err) => {
      console.warn('Error listening to chat messages:', err);
    }
  );
};

export const sendMessage = async (
  chatId: string, 
  senderId: string, 
  text: string, 
  type: 'text' | 'image' | 'audio' = 'text',
  mediaUrl?: string,
  senderProfile?: UserProfile
): Promise<void> => {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  
  let previewText = text;
  if (type === 'image') previewText = '📷 Photo';
  if (type === 'audio') previewText = '🎤 Voice Note';

  const newMessage = {
    chatId,
    senderId,
    senderName: senderProfile?.displayName || 'User',
    senderPhoto: senderProfile?.photoURL || '',
    text,
    type,
    ...(mediaUrl ? { mediaUrl } : {}),
    timestamp: serverTimestamp(),
    readBy: [senderId],
    reactions: {}
  };

  await addDoc(messagesRef, newMessage);

  // Get chat document to increment unread counts for recipients
  const chatRef = doc(db, 'chats', chatId);
  const chatSnap = await getDoc(chatRef);
  if (chatSnap.exists()) {
    const chatData = chatSnap.data() as ChatRoom;
    const recipients = chatData.participants.filter(p => p !== senderId);

    const unreadUpdates: { [key: string]: any } = {};
    recipients.forEach(rUid => {
      unreadUpdates[`unreadCounts.${rUid}`] = increment(1);
    });

    await updateDoc(chatRef, {
      lastMessage: previewText,
      lastMessageSenderId: senderId,
      lastMessageTime: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...unreadUpdates
    });
  }
};

export const markChatAsRead = async (chatId: string, currentUid: string): Promise<void> => {
  // Clear unread count on chat document
  const chatRef = doc(db, 'chats', chatId);
  await updateDoc(chatRef, {
    [`unreadCounts.${currentUid}`]: 0
  });

  // Mark unread messages in subcollection with currentUid in readBy
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(30));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const data = docSnap.data() as ChatMessage;
      if (data.readBy && !data.readBy.includes(currentUid)) {
        updateDoc(docSnap.ref, {
          readBy: arrayUnion(currentUid)
        });
      }
    });
  } catch (err) {
    console.warn('Error marking messages as read:', err);
  }
};

export const setTypingIndicator = async (
  chatId: string, 
  userId: string, 
  isTyping: boolean
): Promise<void> => {
  const chatRef = doc(db, 'chats', chatId);
  await updateDoc(chatRef, {
    [`typing.${userId}`]: isTyping
  });
};

export const toggleMessageReaction = async (
  chatId: string, 
  messageId: string, 
  userId: string, 
  emoji: string
): Promise<void> => {
  const msgRef = doc(db, 'chats', chatId, 'messages', messageId);
  const msgSnap = await getDoc(msgRef);
  if (msgSnap.exists()) {
    const data = msgSnap.data() as ChatMessage;
    const currentReactions = data.reactions || {};
    const newReactions = { ...currentReactions };

    if (newReactions[userId] === emoji) {
      delete newReactions[userId];
    } else {
      newReactions[userId] = emoji;
    }

    await updateDoc(msgRef, { reactions: newReactions });
  }
};

export const deleteMessage = async (chatId: string, messageId: string): Promise<void> => {
  const msgRef = doc(db, 'chats', chatId, 'messages', messageId);
  await deleteDoc(msgRef);

  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
    const snap = await getDocs(q);

    const chatRef = doc(db, 'chats', chatId);
    if (!snap.empty) {
      const lastMsg = snap.docs[0].data() as ChatMessage;
      let previewText = lastMsg.text;
      if (lastMsg.type === 'image') previewText = '📷 Photo';
      if (lastMsg.type === 'audio') previewText = '🎤 Voice Note';

      await updateDoc(chatRef, {
        lastMessage: previewText,
        lastMessageSenderId: lastMsg.senderId,
        lastMessageTime: lastMsg.timestamp || serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      await updateDoc(chatRef, {
        lastMessage: '',
        lastMessageSenderId: '',
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    console.warn('Error updating last message after delete:', err);
  }
};


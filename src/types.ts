export interface UserProfile {
  uid: string;
  displayName: string;
  username: string; // e.g. "alex_c" (lowercased)
  userTag: string; // e.g. "#8492"
  email: string;
  photoURL: string;
  bio?: string;
  status?: 'online' | 'offline' | 'away';
  lastSeen?: number | any;
  createdAt: number | any;
  notificationSettings?: {
    browserPush: boolean;
    soundEnabled: boolean;
    inAppBanners: boolean;
  };
}

export interface FriendRequest {
  id: string;
  fromUid: string;
  fromUsername: string;
  fromDisplayName: string;
  fromPhotoURL: string;
  toUid: string;
  toUsername: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number | any;
}

export interface FriendRelation {
  id: string;
  users: [string, string];
  createdAt: number | any;
}

export interface ChatRoom {
  id: string; // e.g. sorted uidA_uidB for 1-on-1 OR auto-generated for group
  participants: string[];
  isGroup?: boolean;
  groupName?: string;
  groupAvatar?: string;
  adminUids?: string[];
  createdBy?: string;
  lastMessage?: string;
  lastMessageSenderId?: string;
  lastMessageTime?: number | any;
  updatedAt: number | any;
  unreadCounts?: { [uid: string]: number };
  typing?: { [uid: string]: boolean };
  // Populated friend detail for UI
  otherUser?: UserProfile;
  participantProfiles?: { [uid: string]: UserProfile };
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  senderPhoto?: string;
  text: string;
  mediaUrl?: string;
  type: 'text' | 'image' | 'audio' | 'system';
  reactions?: { [uid: string]: string };
  timestamp: number | any;
  readBy?: string[];
}


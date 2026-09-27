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
  pushTokens?: {
    [tokenKey: string]: {
      token: string;
      platform: 'android' | 'web' | 'ios';
      updatedAt: number;
    };
  };
  pushSubscriptions?: {
    [subKey: string]: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
      updatedAt: number;
    };
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
  toDisplayName?: string;
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
  mediaThumbnail?: string;
  mediaDuration?: number;
  mediaSize?: number;
  type: 'text' | 'image' | 'video' | 'audio' | 'system' | 'file';
  filename?: string;
  fileSize?: number;
  fileType?: string;
  reactions?: { [uid: string]: string };
  timestamp: number | any;
  readBy?: string[];
  deletedFor?: string[];
  isCallLog?: boolean;
  callId?: string;
  callType?: CallType;
  callStatus?: CallStatus;
  callDuration?: number;
}

export interface LocalBlockedUser {
  uid: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
  userTag?: string;
  blockedAt: number;
}

export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'connected' | 'ended' | 'rejected' | 'missed' | 'busy';

export interface CallSession {
  id: string;
  chatId: string;
  type: CallType;
  callerUid: string;
  callerName: string;
  callerAvatar: string;
  recipientUid: string;
  recipientName: string;
  recipientAvatar: string;
  status: CallStatus;
  offer?: {
    type: 'offer';
    sdp: string;
  };
  answer?: {
    type: 'answer';
    sdp: string;
  };
  createdAt: number | any;
  connectedAt?: number | any;
  endedAt?: number | any;
  durationSeconds?: number;
}



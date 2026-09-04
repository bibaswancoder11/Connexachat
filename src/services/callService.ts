// WebRTC 100% Free Peer-to-Peer Calling Service with Firebase Firestore Signaling
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { CallSession, CallType, CallStatus, UserProfile } from '../types';
import { dispatchBackgroundPushNotification } from './notificationService';
import { sendMessage } from './chatService';

// Public Google STUN servers (100% free, highly reliable, zero API keys required)
export const RTC_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

// 1. Initiate a Call (Audio or Video)
export const initiateCall = async ({
  chatId,
  type,
  callerProfile,
  recipientProfile
}: {
  chatId: string;
  type: CallType;
  callerProfile: UserProfile;
  recipientProfile: UserProfile;
}): Promise<string> => {
  const callsCol = collection(db, 'calls');
  const callDocRef = doc(callsCol);
  const callId = callDocRef.id;

  const newCall: Omit<CallSession, 'id'> = {
    chatId,
    type,
    callerUid: callerProfile.uid,
    callerName: callerProfile.displayName || callerProfile.username,
    callerAvatar: callerProfile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${callerProfile.uid}`,
    recipientUid: recipientProfile.uid,
    recipientName: recipientProfile.displayName || recipientProfile.username,
    recipientAvatar: recipientProfile.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${recipientProfile.uid}`,
    status: 'ringing',
    createdAt: serverTimestamp()
  };

  await setDoc(callDocRef, newCall);

  // Dispatch background push alert so recipient is alerted even if app is backgrounded
  dispatchBackgroundPushNotification({
    recipientUids: [recipientProfile.uid],
    title: type === 'video' ? '📹 Incoming Video Call' : '📞 Incoming Voice Call',
    body: `${callerProfile.displayName} is calling you on Connexa...`,
    icon: callerProfile.photoURL,
    data: {
      type: 'incoming_call',
      callId,
      chatId,
      callerUid: callerProfile.uid,
      callerName: callerProfile.displayName,
      callType: type
    }
  }).catch(err => console.warn('Could not dispatch call push notification:', err));

  return callId;
};

// 2. Set Call Offer SDP
export const setCallOffer = async (
  callId: string,
  offer: RTCSessionDescriptionInit
): Promise<void> => {
  const callDocRef = doc(db, 'calls', callId);
  await updateDoc(callDocRef, {
    offer: {
      type: offer.type,
      sdp: offer.sdp
    }
  });
};

// 3. Set Call Answer SDP & Mark Connected
export const answerCallSession = async (
  callId: string,
  answer: RTCSessionDescriptionInit
): Promise<void> => {
  const callDocRef = doc(db, 'calls', callId);
  await updateDoc(callDocRef, {
    status: 'connected',
    answer: {
      type: answer.type,
      sdp: answer.sdp
    },
    connectedAt: serverTimestamp()
  });
};

// 4. Reject Call (By Recipient)
export const rejectCallSession = async (callId: string): Promise<void> => {
  const callDocRef = doc(db, 'calls', callId);
  await updateDoc(callDocRef, {
    status: 'rejected',
    endedAt: serverTimestamp()
  });
};

// 5. End Active Call (By Either Party)
export const endCallSession = async (
  callId: string,
  durationSeconds: number = 0
): Promise<void> => {
  const callDocRef = doc(db, 'calls', callId);
  await updateDoc(callDocRef, {
    status: 'ended',
    endedAt: serverTimestamp(),
    durationSeconds
  });
};

// 6. Mark Call Missed
export const markCallMissed = async (callId: string): Promise<void> => {
  const callDocRef = doc(db, 'calls', callId);
  await updateDoc(callDocRef, {
    status: 'missed',
    endedAt: serverTimestamp()
  });
};

// 7. Subscribe to a Single Call Session
export const subscribeToCallSession = (
  callId: string,
  onUpdate: (session: CallSession | null) => void
) => {
  const callDocRef = doc(db, 'calls', callId);
  return onSnapshot(callDocRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate({ id: docSnap.id, ...docSnap.data() } as CallSession);
    } else {
      onUpdate(null);
    }
  }, (err) => {
    console.warn('Error listening to call session:', err);
  });
};

// 8. Subscribe to Incoming Calls (Ringing status for current user)
export const subscribeToIncomingCalls = (
  currentUserUid: string,
  onIncomingCall: (session: CallSession) => void
) => {
  const callsCol = collection(db, 'calls');
  const q = query(
    callsCol,
    where('recipientUid', '==', currentUserUid),
    where('status', '==', 'ringing')
  );

  return onSnapshot(q, (snapshot) => {
    const now = Date.now();
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added' || change.type === 'modified') {
        const data = change.doc.data();
        // Disregard stale calls older than 75 seconds
        let createdAtMillis = now;
        if (data.createdAt) {
          createdAtMillis = data.createdAt.toMillis ? data.createdAt.toMillis() : (data.createdAt.seconds ? data.createdAt.seconds * 1000 : data.createdAt);
        }
        if (now - createdAtMillis < 75000) {
          onIncomingCall({ id: change.doc.id, ...data } as CallSession);
        }
      }
    });
  }, (err) => {
    console.warn('Error listening for incoming calls:', err);
  });
};

// 9. ICE Candidates Exchange
export const addIceCandidate = async (
  callId: string,
  candidate: RTCIceCandidate,
  role: 'caller' | 'recipient'
): Promise<void> => {
  try {
    const candidateCol = collection(db, 'calls', callId, `${role}Candidates`);
    await addDoc(candidateCol, candidate.toJSON());
  } catch (err) {
    console.warn(`Could not add ${role} ICE candidate:`, err);
  }
};

export const subscribeToIceCandidates = (
  callId: string,
  remoteRole: 'caller' | 'recipient',
  onCandidate: (candidate: RTCIceCandidateInit) => void
) => {
  const candidateCol = collection(db, 'calls', callId, `${remoteRole}Candidates`);
  return onSnapshot(candidateCol, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidateData = change.doc.data() as RTCIceCandidateInit;
        onCandidate(candidateData);
      }
    });
  }, (err) => {
    console.warn(`Error listening to ${remoteRole} candidates:`, err);
  });
};

// 10. Record Call in Chat Log (WhatsApp Style System Message)
export const logCallInChat = async (
  chatId: string,
  call: CallSession,
  status: CallStatus,
  durationSeconds: number = 0
): Promise<void> => {
  try {
    const isVideo = call.type === 'video';
    const icon = isVideo ? '📹' : '📞';
    const typeLabel = isVideo ? 'Video call' : 'Voice call';

    let text = '';
    if (status === 'ended') {
      if (durationSeconds > 0) {
        const mins = Math.floor(durationSeconds / 60);
        const secs = durationSeconds % 60;
        const durFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        text = `${icon} ${typeLabel} • ${durFormatted}`;
      } else {
        text = `${icon} ${typeLabel} ended`;
      }
    } else if (status === 'rejected') {
      text = `${icon} Declined ${typeLabel.toLowerCase()}`;
    } else if (status === 'missed') {
      text = `${icon} Missed ${typeLabel.toLowerCase()}`;
    }

    if (!text) return;

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesRef, {
      chatId,
      senderId: call.callerUid,
      senderName: call.callerName,
      text,
      type: 'system',
      isCallLog: true,
      callId: call.id,
      callType: call.type,
      callStatus: status,
      callDuration: durationSeconds,
      timestamp: serverTimestamp(),
      readBy: [call.callerUid, call.recipientUid],
      deletedFor: []
    });

    const chatRef = doc(db, 'chats', chatId);
    await updateDoc(chatRef, {
      lastMessage: text,
      lastMessageSenderId: call.callerUid,
      lastMessageTime: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not log call event to chat room:', err);
  }
};

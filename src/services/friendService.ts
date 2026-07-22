import { 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp, 
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, FriendRequest, FriendRelation } from '../types';
import { getUserProfile } from './userService';

export const getFriendshipId = (uid1: string, uid2: string): string => {
  return [uid1, uid2].sort().join('_');
};

export const getFriendRequestId = (fromUid: string, toUid: string): string => {
  return `${fromUid}_${toUid}`;
};

export const sendFriendRequest = async (
  currentUser: UserProfile, 
  targetUser: UserProfile
): Promise<void> => {
  const reqId = getFriendRequestId(currentUser.uid, targetUser.uid);
  const reqRef = doc(db, 'friendRequests', reqId);

  const requestData: FriendRequest = {
    id: reqId,
    fromUid: currentUser.uid,
    fromUsername: currentUser.username,
    fromDisplayName: currentUser.displayName,
    fromPhotoURL: currentUser.photoURL,
    toUid: targetUser.uid,
    toUsername: targetUser.username,
    status: 'pending',
    createdAt: serverTimestamp()
  };

  await setDoc(reqRef, requestData);
};

export const acceptFriendRequest = async (
  request: FriendRequest
): Promise<void> => {
  const friendshipId = getFriendshipId(request.fromUid, request.toUid);
  
  // Create friend relationship doc
  await setDoc(doc(db, 'friends', friendshipId), {
    id: friendshipId,
    users: [request.fromUid, request.toUid].sort() as [string, string],
    createdAt: serverTimestamp()
  });

  // Delete or update friend request
  await deleteDoc(doc(db, 'friendRequests', request.id));
};

export const rejectOrCancelFriendRequest = async (requestId: string): Promise<void> => {
  await deleteDoc(doc(db, 'friendRequests', requestId));
};

export const removeFriend = async (uid1: string, uid2: string): Promise<void> => {
  const friendshipId = getFriendshipId(uid1, uid2);
  await deleteDoc(doc(db, 'friends', friendshipId));

  // Optionally delete chat as well or keep chat history
};

export const checkIsFriend = async (uid1: string, uid2: string): Promise<boolean> => {
  const friendshipId = getFriendshipId(uid1, uid2);
  const friendshipDoc = await getDoc(doc(db, 'friends', friendshipId));
  return friendshipDoc.exists();
};

export const subscribeToIncomingRequests = (
  uid: string, 
  callback: (requests: FriendRequest[]) => void
) => {
  const q = query(
    collection(db, 'friendRequests'),
    where('toUid', '==', uid)
  );

  return onSnapshot(
    q, 
    (snapshot) => {
      const list: FriendRequest[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as FriendRequest);
      });
      callback(list);
    },
    (err) => {
      console.warn('Error listening to incoming requests:', err);
    }
  );
};

export const subscribeToOutgoingRequests = (
  uid: string, 
  callback: (requests: FriendRequest[]) => void
) => {
  const q = query(
    collection(db, 'friendRequests'),
    where('fromUid', '==', uid)
  );

  return onSnapshot(
    q, 
    (snapshot) => {
      const list: FriendRequest[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as FriendRequest);
      });
      callback(list);
    },
    (err) => {
      console.warn('Error listening to outgoing requests:', err);
    }
  );
};

export const subscribeToFriends = (
  currentUid: string, 
  callback: (friends: UserProfile[]) => void
) => {
  const q = query(
    collection(db, 'friends'),
    where('users', 'array-contains', currentUid)
  );

  return onSnapshot(
    q, 
    async (snapshot) => {
      const friendUids: string[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as FriendRelation;
        const otherUid = data.users.find((u) => u !== currentUid);
        if (otherUid) friendUids.push(otherUid);
      });

      if (friendUids.length === 0) {
        callback([]);
        return;
      }

      // Fetch friend profiles
      const profiles = await Promise.all(
        friendUids.map((uid) => getUserProfile(uid))
      );
      callback(profiles.filter((p): p is UserProfile => p !== null));
    },
    (err) => {
      console.warn('Error listening to friends list:', err);
    }
  );
};

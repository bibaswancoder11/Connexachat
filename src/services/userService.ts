import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  getDocs, 
  serverTimestamp, 
  limit,
  where,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';

// Generate a random 4-digit unique tag e.g. "#4829"
export const generateUserTag = (): string => {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `#${num}`;
};

export const withTimeout = <T>(promise: Promise<T>, ms: number = 4000, errorMsg: string = 'Operation timed out'): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
};

const ACCOUNTS_KEY = 'connexa_registered_accounts';

export const getLocalRegisteredAccounts = (): UserProfile[] => {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveLocalRegisteredAccount = (profile: UserProfile): void => {
  try {
    const accounts = getLocalRegisteredAccounts();
    const existingIndex = accounts.findIndex(
      a => (a.email && profile.email && a.email.toLowerCase() === profile.email.toLowerCase()) || 
           a.uid === profile.uid || 
           (a.username && profile.username && a.username.toLowerCase() === profile.username.toLowerCase())
    );
    if (existingIndex >= 0) {
      accounts[existingIndex] = { ...accounts[existingIndex], ...profile };
    } else {
      accounts.push(profile);
    }
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.warn('Could not save account locally:', e);
  }
};

export const findAccountByEmail = async (email: string): Promise<UserProfile | null> => {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return null;

  // 1. Check local registered accounts
  const localAccounts = getLocalRegisteredAccounts();
  const foundLocal = localAccounts.find(a => a.email?.toLowerCase() === cleanEmail);
  if (foundLocal) return foundLocal;

  // 2. Query Firestore
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', cleanEmail), limit(1));
    const snap = await withTimeout(getDocs(q), 3000, 'Find account timeout');
    if (!snap.empty) {
      const prof = snap.docs[0].data() as UserProfile;
      saveLocalRegisteredAccount(prof);
      return prof;
    }
  } catch (err) {
    console.warn('Firestore query for email failed:', err);
  }

  return null;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  if (!uid) return null;

  // Check local first
  const localAccounts = getLocalRegisteredAccounts();
  const localMatch = localAccounts.find(a => a.uid === uid);

  try {
    const userDoc = await withTimeout(getDoc(doc(db, 'users', uid)), 3500, 'Fetch profile timeout');
    if (userDoc.exists()) {
      const data = userDoc.data();
      const prof: UserProfile = {
        uid,
        email: data.email || localMatch?.email || '',
        displayName: data.displayName || localMatch?.displayName || 'Connexa User',
        username: data.username || localMatch?.username || `user_${uid.slice(0, 5)}`,
        userTag: data.userTag || localMatch?.userTag || '#1000',
        photoURL: data.photoURL || localMatch?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
        bio: data.bio !== undefined ? data.bio : (localMatch?.bio || ''),
        status: data.status || 'online',
        lastSeen: data.lastSeen || serverTimestamp(),
        createdAt: data.createdAt || serverTimestamp()
      };
      saveLocalRegisteredAccount(prof);
      return prof;
    }
  } catch (error) {
    console.warn('Error fetching user profile from Firestore:', error);
  }

  return localMatch || null;
};

export const checkUsernameAvailable = async (username: string): Promise<boolean> => {
  const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername || cleanUsername.length < 3) return false;

  // Check local accounts first
  const localAccounts = getLocalRegisteredAccounts();
  const isTakenLocally = localAccounts.some(a => a.username?.toLowerCase() === cleanUsername);
  if (isTakenLocally) return false;

  try {
    const usernameDoc = await withTimeout(getDoc(doc(db, 'usernames', cleanUsername)), 2500, 'Check username timeout');
    return !usernameDoc.exists();
  } catch (error) {
    console.warn('Error checking username availability:', error);
    return !isTakenLocally;
  }
};

export const createUserProfile = async (
  uid: string, 
  email: string, 
  displayName: string, 
  rawUsername: string,
  photoURL?: string,
  bio?: string
): Promise<UserProfile> => {
  const cleanUsername = rawUsername.toLowerCase().trim().replace(/[^a-z0-9_]/g, '') || `user_${uid.slice(0, 6)}`;
  const userTag = generateUserTag();
  const defaultPhoto = photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`;
  const defaultBio = bio !== undefined ? bio : 'Hey there! I am using Connexa to stay connected.';

  const profile: UserProfile = {
    uid,
    email: email || '',
    displayName: displayName || cleanUsername,
    username: cleanUsername,
    userTag,
    photoURL: defaultPhoto,
    bio: defaultBio,
    status: 'online',
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  // Always save to local accounts registry
  saveLocalRegisteredAccount(profile);

  try {
    await setDoc(doc(db, 'users', uid), profile, { merge: true });
    // Reserve username mapping
    await setDoc(doc(db, 'usernames', cleanUsername), { uid }, { merge: true });
  } catch (err) {
    console.warn('Could not persist profile to Firestore, saved locally:', err);
  }

  return profile;
};

export const updateUserProfile = async (
  uid: string, 
  updates: Partial<UserProfile>
): Promise<UserProfile | null> => {
  if (!uid) return null;

  // 1. Immediately update local storage so refresh or offline mode has the updated bio & photo
  const localAccounts = getLocalRegisteredAccounts();
  const existingIdx = localAccounts.findIndex(a => a.uid === uid);
  let updatedProf: UserProfile;

  if (existingIdx >= 0) {
    updatedProf = {
      ...localAccounts[existingIdx],
      ...updates,
      uid
    };
    localAccounts[existingIdx] = updatedProf;
  } else {
    updatedProf = {
      uid,
      displayName: updates.displayName || 'Connexa User',
      username: updates.username || `user_${uid.slice(0, 5)}`,
      userTag: updates.userTag || '#1000',
      email: updates.email || '',
      photoURL: updates.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
      bio: updates.bio || '',
      status: updates.status || 'online',
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      ...updates
    };
    localAccounts.push(updatedProf);
  }
  saveLocalRegisteredAccount(updatedProf);

  // 2. Persist to Firestore with merge: true (handles existing or newly created documents safely)
  try {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, {
      ...updates,
      lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('Firestore update profile warning:', e);
  }

  return updatedProf;
};

export const updateUserPresence = async (uid: string, status: 'online' | 'offline' = 'online'): Promise<void> => {
  if (!uid) return;
  try {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, {
      status,
      lastSeen: serverTimestamp()
    });
  } catch (e) {
    console.warn('Firestore presence update warning:', e);
  }
};

export const isUserOnline = (user?: UserProfile | null): boolean => {
  if (!user) return false;
  if (user.status === 'offline') return false;

  if (!user.lastSeen) {
    return user.status === 'online';
  }

  try {
    let lastSeenMs: number = 0;
    if (typeof user.lastSeen === 'number') {
      lastSeenMs = user.lastSeen;
    } else if (user.lastSeen?.toMillis && typeof user.lastSeen.toMillis === 'function') {
      lastSeenMs = user.lastSeen.toMillis();
    } else if (user.lastSeen?.seconds) {
      lastSeenMs = user.lastSeen.seconds * 1000;
    } else {
      lastSeenMs = new Date(user.lastSeen).getTime();
    }

    if (isNaN(lastSeenMs) || lastSeenMs <= 0) {
      return user.status === 'online';
    }

    // Consider online if active within last 3 minutes (180,000 ms)
    const THREE_MINUTES = 3 * 60 * 1000;
    const now = Date.now();
    return (now - lastSeenMs) < THREE_MINUTES;
  } catch {
    return user.status === 'online';
  }
};

export const subscribeToUserProfile = (uid: string, callback: (profile: UserProfile | null) => void) => {
  return onSnapshot(
    doc(db, 'users', uid),
    (docSnap) => {
      if (docSnap.exists()) {
        const prof = docSnap.data() as UserProfile;
        saveLocalRegisteredAccount(prof);
        callback(prof);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn(`Error subscribing to user profile ${uid}:`, err);
    }
  );
};

export const searchUsers = async (searchTerm: string, currentUid: string): Promise<UserProfile[]> => {
  const term = searchTerm.trim().toLowerCase().replace(/^@/, '');

  const candidatesMap = new Map<string, UserProfile>();

  // 1. Add local registered accounts
  const localAccounts = getLocalRegisteredAccounts();
  localAccounts.forEach(u => {
    if (u && u.uid && u.uid !== currentUid) {
      candidatesMap.set(u.uid, u);
    }
  });

  // 2. Query Firestore users
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await withTimeout(getDocs(query(usersRef, limit(40))), 3500, 'Search timeout');
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as UserProfile;
      if (data && data.uid && data.uid !== currentUid) {
        candidatesMap.set(data.uid, data);
      }
    });
  } catch (error) {
    console.warn('Firestore search query warning:', error);
  }

  const allCandidates = Array.from(candidatesMap.values());

  if (!term) {
    return allCandidates;
  }

  return allCandidates.filter((data) => {
    const nameMatch = data.displayName?.toLowerCase().includes(term);
    const usernameMatch = data.username?.toLowerCase().includes(term);
    const tagMatch = data.userTag?.toLowerCase().includes(term);
    const uidMatch = data.uid?.toLowerCase().includes(term);
    const emailMatch = data.email?.toLowerCase().includes(term);
    const combinedMatch = `@${data.username}${data.userTag}`.toLowerCase().includes(term);

    return nameMatch || usernameMatch || tagMatch || uidMatch || emailMatch || combinedMatch;
  });
};

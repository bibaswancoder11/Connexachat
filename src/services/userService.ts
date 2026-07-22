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
  where
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
  // Check local first if offline
  const localAccounts = getLocalRegisteredAccounts();
  const localMatch = localAccounts.find(a => a.uid === uid);

  try {
    const userDoc = await withTimeout(getDoc(doc(db, 'users', uid)), 3000, 'Fetch profile timeout');
    if (userDoc.exists()) {
      const prof = userDoc.data() as UserProfile;
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
  photoURL?: string
): Promise<UserProfile> => {
  const cleanUsername = rawUsername.toLowerCase().trim().replace(/[^a-z0-9_]/g, '') || `user_${uid.slice(0, 6)}`;
  const userTag = generateUserTag();
  const defaultPhoto = photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`;

  const profile: UserProfile = {
    uid,
    email: email || '',
    displayName: displayName || cleanUsername,
    username: cleanUsername,
    userTag,
    photoURL: defaultPhoto,
    bio: 'Hey there! I am using Connexa to stay connected.',
    status: 'online',
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  // Always save to local accounts registry
  saveLocalRegisteredAccount(profile);

  try {
    await setDoc(doc(db, 'users', uid), profile);
    // Reserve username mapping
    await setDoc(doc(db, 'usernames', cleanUsername), { uid });
  } catch (err) {
    console.warn('Could not persist profile to Firestore, saved locally:', err);
  }

  return profile;
};

export const updateUserProfile = async (
  uid: string, 
  updates: Partial<UserProfile>
): Promise<void> => {
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      ...updates,
      lastSeen: serverTimestamp()
    });
  } catch (e) {
    console.warn('Firestore update profile warning:', e);
  }
};

export const searchUsers = async (searchTerm: string, currentUid: string): Promise<UserProfile[]> => {
  const term = searchTerm.trim().toLowerCase().replace(/^@/, '');

  const defaultSuggested: UserProfile[] = [
    {
      uid: 'demo_alex',
      email: 'alex@example.com',
      displayName: 'Alex Chen',
      username: 'alex_c',
      userTag: '#1042',
      photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=alex_c',
      bio: 'Software engineer & tech enthusiast. Love building apps!',
      status: 'online',
      lastSeen: null,
      createdAt: null
    },
    {
      uid: 'demo_sarah',
      email: 'sarah@example.com',
      displayName: 'Sarah Miller',
      username: 'sarah_m',
      userTag: '#2084',
      photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=sarah_m',
      bio: 'UI/UX Designer & digital creator.',
      status: 'offline',
      lastSeen: null,
      createdAt: null
    },
    {
      uid: 'demo_david',
      email: 'david@example.com',
      displayName: 'David Kim',
      username: 'david_k',
      userTag: '#3099',
      photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=david_k',
      bio: 'Gamer, traveler & coffee lover.',
      status: 'online',
      lastSeen: null,
      createdAt: null
    },
    {
      uid: 'demo_emma',
      email: 'emma@example.com',
      displayName: 'Emma Watson',
      username: 'emma_w',
      userTag: '#4012',
      photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=emma_w',
      bio: 'Product Manager @ TechCorp',
      status: 'online',
      lastSeen: null,
      createdAt: null
    }
  ];

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

  // 3. Add default suggested
  defaultSuggested.forEach(sugg => {
    if (sugg.uid !== currentUid && !candidatesMap.has(sugg.uid)) {
      candidatesMap.set(sugg.uid, sugg);
    }
  });

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

import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  signInAnonymously,
  User 
} from 'firebase/auth';
import { auth } from '../firebase';
import { serverTimestamp } from 'firebase/firestore';
import { UserProfile } from '../types';
import { getUserProfile, createUserProfile, updateUserProfile, withTimeout, findAccountByEmail, checkUsernameAvailable } from '../services/userService';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  registerWithEmail: (email: string, pass: string, name: string, username: string, photoURL?: string) => Promise<UserProfile>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  loginGuest: (name?: string, username?: string, photoURL?: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_GUEST_KEY = 'connexa_demo_guest_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchProfile = async (uid: string) => {
    const prof = await getUserProfile(uid);
    if (prof) setUserProfile(prof);
    return prof;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        localStorage.removeItem(DEMO_GUEST_KEY);
        setCurrentUser(user);
        try {
          let prof = await getUserProfile(user.uid);
          if (!prof) {
            prof = await createUserProfile(user.uid, user.email || '', user.displayName || 'Connexa User', `user_${user.uid.slice(0, 5)}`);
          }
          setUserProfile(prof);
        } catch (err) {
          console.warn('Error fetching user profile on auth state change:', err);
          setUserProfile({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Connexa User',
            username: `user_${user.uid.slice(0, 5)}`,
            userTag: '#1000',
            photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
            bio: 'Hey there! I am using Connexa to stay connected.',
            status: 'online',
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp()
          });
        }
      } else {
        // Check for local demo guest session
        const savedGuest = localStorage.getItem(DEMO_GUEST_KEY);
        if (savedGuest) {
          try {
            const guestProf = JSON.parse(savedGuest) as UserProfile;
            setCurrentUser({ uid: guestProf.uid, isAnonymous: true } as User);
            setUserProfile(guestProf);
          } catch {
            localStorage.removeItem(DEMO_GUEST_KEY);
            setCurrentUser(null);
            setUserProfile(null);
          }
        } else {
          setCurrentUser(null);
          setUserProfile(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const registerWithEmail = async (
    email: string, 
    pass: string, 
    name: string, 
    username: string, 
    photoURL?: string
  ): Promise<UserProfile> => {
    localStorage.removeItem(DEMO_GUEST_KEY);

    const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');

    // 1. Check if username is taken
    const isAvail = await checkUsernameAvailable(cleanUsername);
    if (!isAvail) {
      throw new Error(`The username '@${cleanUsername}' is already taken. Please choose another username.`);
    }

    // 2. Check if email is already registered
    const existingByEmail = await findAccountByEmail(email);
    if (existingByEmail) {
      throw new Error(`An account with email '${email}' is already registered. Please log in.`);
    }

    let userCred: any = null;
    try {
      userCred = await withTimeout(
        createUserWithEmailAndPassword(auth, email, pass),
        8000,
        'Registration connection timed out. Please check your credentials and network.'
      );
    } catch (authErr: any) {
      console.warn('Firebase createUserWithEmailAndPassword failed or disabled:', authErr);
      if (
        authErr.code === 'auth/operation-not-allowed' || 
        authErr.message?.includes('operation-not-allowed') ||
        authErr.message?.includes('network-request-failed')
      ) {
        // Fallback to local demo account when Email Auth is disabled in Firebase Console
        const localUid = `local_${email.toLowerCase().replace(/[^a-z0-9]/gi, '_')}`;
        const localUserObj = { uid: localUid, email, displayName: name };
        
        const localProfile = await createUserProfile(localUid, email, name, cleanUsername, photoURL);

        localStorage.setItem(DEMO_GUEST_KEY, JSON.stringify(localProfile));
        setCurrentUser(localUserObj as User);
        setUserProfile(localProfile);
        return localProfile;
      } else if (authErr.code === 'auth/email-already-in-use') {
        throw new Error(`An account with email '${email}' is already registered. Please log in.`);
      } else {
        throw authErr;
      }
    }

    let profile: UserProfile;
    try {
      profile = await withTimeout(
        createUserProfile(userCred.user.uid, email, name, cleanUsername, photoURL),
        5000,
        'Profile creation timed out'
      );
    } catch (err) {
      console.warn('Could not save user profile to Firestore:', err);
      profile = {
        uid: userCred.user.uid,
        email,
        displayName: name,
        username: cleanUsername,
        userTag: '#1000',
        photoURL: photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`,
        bio: 'Hey there! I am using Connexa to stay connected.',
        status: 'online',
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      };
    }
    setUserProfile(profile);
    return profile;
  };

  const loginWithEmail = async (email: string, pass: string): Promise<void> => {
    localStorage.removeItem(DEMO_GUEST_KEY);

    // Find existing account first
    const registeredAccount = await findAccountByEmail(email);

    let userCred: any = null;
    try {
      userCred = await withTimeout(
        signInWithEmailAndPassword(auth, email, pass),
        8000,
        'Login request timed out. Please check your network and try again.'
      );
    } catch (authErr: any) {
      console.warn('Firebase signInWithEmailAndPassword failed or disabled:', authErr);
      if (
        authErr.code === 'auth/operation-not-allowed' || 
        authErr.message?.includes('operation-not-allowed') ||
        authErr.message?.includes('network-request-failed')
      ) {
        if (registeredAccount) {
          localStorage.setItem(DEMO_GUEST_KEY, JSON.stringify(registeredAccount));
          setCurrentUser({ uid: registeredAccount.uid, email: registeredAccount.email, displayName: registeredAccount.displayName } as User);
          setUserProfile(registeredAccount);
          return;
        } else {
          throw new Error(`No account found registered with email '${email}'. Please click "Register" to create an account.`);
        }
      } else {
        throw authErr;
      }
    }

    let prof = await getUserProfile(userCred.user.uid);
    if (!prof && registeredAccount) {
      prof = registeredAccount;
    }
    if (!prof) {
      throw new Error(`No account profile found for '${email}'. Please click "Register" to create an account.`);
    }

    setUserProfile(prof);
  };

  const loginGuest = async (
    name: string = 'Demo User', 
    username: string = 'demo_user', 
    photoURL?: string
  ): Promise<UserProfile> => {
    let uid = `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let userObj: any = { uid, isAnonymous: true };

    try {
      const userCred = await withTimeout(signInAnonymously(auth), 4000, 'Anonymous login timeout');
      if (userCred.user) {
        uid = userCred.user.uid;
        userObj = userCred.user;
      }
    } catch (authErr) {
      console.warn('Firebase signInAnonymously skipped, using local demo guest session:', authErr);
    }

    let prof: UserProfile | null = null;
    try {
      prof = await getUserProfile(uid);
      if (!prof) {
        prof = await createUserProfile(uid, '', name, username, photoURL);
      }
    } catch (e) {
      console.warn('Firestore guest profile skipped:', e);
    }

    if (!prof) {
      prof = {
        uid,
        email: '',
        displayName: name,
        username: username,
        userTag: '#1000',
        photoURL: photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
        bio: 'Demo Guest User on Connexa',
        status: 'online',
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      };
    }

    // Persist demo guest session in localStorage so onAuthStateChanged doesn't bounce it back to login screen
    localStorage.setItem(DEMO_GUEST_KEY, JSON.stringify(prof));

    setCurrentUser(userObj);
    setUserProfile(prof);
    return prof;
  };

  const logout = async () => {
    localStorage.removeItem(DEMO_GUEST_KEY);
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('SignOut warning:', e);
    }
    setCurrentUser(null);
    setUserProfile(null);
  };

  const refreshProfile = async () => {
    if (currentUser) {
      await fetchProfile(currentUser.uid);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (currentUser && userProfile) {
      try {
        await updateUserProfile(currentUser.uid, updates);
      } catch (err) {
        console.warn('Cloud update profile skipped:', err);
      }
      const updated = { ...userProfile, ...updates };
      setUserProfile(updated);
      if (localStorage.getItem(DEMO_GUEST_KEY)) {
        localStorage.setItem(DEMO_GUEST_KEY, JSON.stringify(updated));
      }
    }
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      userProfile,
      loading,
      registerWithEmail,
      loginWithEmail,
      loginGuest,
      logout,
      refreshProfile,
      updateProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

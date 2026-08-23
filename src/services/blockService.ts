import { LocalBlockedUser, UserProfile } from '../types';

const STORAGE_PREFIX = 'connexa_blocked_users_';
const BLOCK_EVENT_NAME = 'connexa_blocked_users_changed';

/**
 * Get all locally blocked users for the current device/account
 */
export const getBlockedUsers = (currentUid: string): LocalBlockedUser[] => {
  if (typeof window === 'undefined' || !currentUid) return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${currentUid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to parse blocked users from local storage:', err);
    return [];
  }
};

/**
 * Check if a specific target user is blocked locally
 */
export const isUserBlockedLocally = (currentUid: string, targetUid: string): boolean => {
  if (!currentUid || !targetUid) return false;
  const blocked = getBlockedUsers(currentUid);
  return blocked.some(u => u.uid === targetUid);
};

/**
 * Block a user locally on this device.
 * As per specifications, the current user will still receive messages from the blocked user,
 * but the current user cannot send any messages to the blocked user.
 */
export const blockUserLocally = (
  currentUid: string, 
  targetUser: UserProfile | { uid: string; displayName?: string; username?: string; photoURL?: string; userTag?: string }
): void => {
  if (!currentUid || !targetUser?.uid) return;
  
  const currentBlocked = getBlockedUsers(currentUid);
  const exists = currentBlocked.some(u => u.uid === targetUser.uid);

  if (!exists) {
    const newEntry: LocalBlockedUser = {
      uid: targetUser.uid,
      displayName: targetUser.displayName || 'User',
      username: targetUser.username || '',
      photoURL: targetUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${targetUser.uid}`,
      userTag: targetUser.userTag || '',
      blockedAt: Date.now()
    };

    const updated = [newEntry, ...currentBlocked];
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${currentUid}`, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent(BLOCK_EVENT_NAME, { detail: { currentUid, targetUid: targetUser.uid, action: 'blocked' } }));
    } catch (err) {
      console.error('Failed to save blocked user to localStorage:', err);
    }
  }
};

/**
 * Unblock a user locally on this device
 */
export const unblockUserLocally = (currentUid: string, targetUid: string): void => {
  if (!currentUid || !targetUid) return;

  const currentBlocked = getBlockedUsers(currentUid);
  const updated = currentBlocked.filter(u => u.uid !== targetUid);

  try {
    localStorage.setItem(`${STORAGE_PREFIX}${currentUid}`, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(BLOCK_EVENT_NAME, { detail: { currentUid, targetUid, action: 'unblocked' } }));
  } catch (err) {
    console.error('Failed to remove blocked user from localStorage:', err);
  }
};

/**
 * Subscribe to changes in blocked users list across the app
 */
export const subscribeToBlockedUsers = (
  currentUid: string, 
  callback: (blocked: LocalBlockedUser[]) => void
): (() => void) => {
  const handleEvent = (e: Event) => {
    const custom = e as CustomEvent;
    if (!custom.detail || custom.detail.currentUid === currentUid) {
      callback(getBlockedUsers(currentUid));
    }
  };

  const handleStorage = (e: StorageEvent) => {
    if (e.key === `${STORAGE_PREFIX}${currentUid}`) {
      callback(getBlockedUsers(currentUid));
    }
  };

  window.addEventListener(BLOCK_EVENT_NAME, handleEvent);
  window.addEventListener('storage', handleStorage);

  // Initial call
  callback(getBlockedUsers(currentUid));

  return () => {
    window.removeEventListener(BLOCK_EVENT_NAME, handleEvent);
    window.removeEventListener('storage', handleStorage);
  };
};

// Notification service providing Native Android Push & System Notifications (via Capacitor),
// Web Push Notifications, Service Worker integration, Haptics, and Synthetic Web Audio Chimes.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, NotificationType } from '@capacitor/haptics';

export type NotificationPermissionState = 'granted' | 'denied' | 'default';

let swRegistration: ServiceWorkerRegistration | null = null;
let nativeChannelsInitialized = false;

// Callbacks for notification clicks (both Native and Web)
export interface NotificationActionPayload {
  type?: string;
  chatId?: string;
  friendUid?: string;
  tab?: string;
  [key: string]: any;
}
type NotificationActionHandler = (data: NotificationActionPayload) => void;
const actionHandlers: Set<NotificationActionHandler> = new Set();

export const onNotificationAction = (handler: NotificationActionHandler) => {
  actionHandlers.add(handler);
  return () => {
    actionHandlers.delete(handler);
  };
};

// Check if running inside native Android / iOS app via Capacitor
export const isNativePlatform = (): boolean => {
  return Capacitor.isNativePlatform();
};

// Initialize Android Native Notification Channels
export const initNativeNotificationChannels = async () => {
  if (!isNativePlatform() || nativeChannelsInitialized) return;

  try {
    // 1. High-priority Channel for Real-Time Direct & Group Messages
    await LocalNotifications.createChannel({
      id: 'connexa_messages_channel',
      name: 'Connexa Real-Time Messages',
      description: 'Incoming direct chats and group messages',
      importance: 5, // MAX importance - heads-up banner display
      visibility: 1, // Public on lockscreen
      vibration: true,
      lights: true,
      lightColor: '#2563EB',
    });

    // 2. Channel for Friend Requests & Social Alerts
    await LocalNotifications.createChannel({
      id: 'connexa_requests_channel',
      name: 'Connexa Friend Requests & Alerts',
      description: 'Friend requests, connection acceptances, and invites',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#2563EB',
    });

    // 3. Register Native Action Listener (User taps notification in Android status bar)
    await LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
      const extraData = notificationAction.notification.extra || {};
      console.log('User tapped native notification:', notificationAction, extraData);
      
      actionHandlers.forEach((handler) => {
        try {
          handler(extraData);
        } catch (e) {
          console.warn('Error executing notification action handler:', e);
        }
      });
    });

    nativeChannelsInitialized = true;
    console.log('Connexa native Android notification channels initialized successfully.');
  } catch (err) {
    console.warn('Failed to initialize Android Notification Channels:', err);
  }
};

// Register Service Worker for background notifications on Web / PWA environments
export const initServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    swRegistration = reg;
    console.log('Connexa Service Worker registered with scope:', reg.scope);
    return reg;
  } catch (err) {
    console.warn('Service Worker registration warning:', err);
    return null;
  }
};

export const isInIframe = (): boolean => {
  if (isNativePlatform()) return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
};

export const getNotificationPermission = async (): Promise<NotificationPermissionState> => {
  if (isNativePlatform()) {
    try {
      const check = await LocalNotifications.checkPermissions();
      if (check.display === 'granted') return 'granted';
      if (check.display === 'denied') return 'denied';
      return 'default';
    } catch (e) {
      return 'default';
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission as NotificationPermissionState;
};

export const requestNotificationPermission = async (): Promise<NotificationPermissionState> => {
  // 1. Native Android Permissions via Capacitor
  if (isNativePlatform()) {
    try {
      await initNativeNotificationChannels();
      const check = await LocalNotifications.checkPermissions();
      if (check.display === 'granted') {
        return 'granted';
      }

      const req = await LocalNotifications.requestPermissions();
      if (req.display === 'granted') {
        await initNativeNotificationChannels();
        return 'granted';
      } else if (req.display === 'denied') {
        return 'denied';
      }
      return 'default';
    } catch (err) {
      console.warn('Native notification permission error:', err);
      return 'default';
    }
  }

  // 2. Web / PWA Fallback
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  try {
    let currentPerm = Notification.permission;
    if (currentPerm === 'default') {
      if (isInIframe()) {
        console.warn('Notification permission request skipped inside iframe preview context.');
        return 'default';
      }
      currentPerm = await Notification.requestPermission();
    }
    
    if (currentPerm === 'granted') {
      await initServiceWorker();
    }
    return currentPerm as NotificationPermissionState;
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return 'denied';
  }
};

export const showWebNotification = async (
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    data?: any;
    channelId?: 'connexa_messages_channel' | 'connexa_requests_channel';
    onClick?: () => void;
  }
) => {
  // A. Native Android Platform Notification Dispatch
  if (isNativePlatform()) {
    try {
      await initNativeNotificationChannels();
      const notifId = Math.floor((Date.now() % 1000000) + Math.random() * 900);

      // Trigger native tactile haptic feedback
      try {
        await Haptics.notification({ type: NotificationType.Success });
      } catch (hapticErr) {
        // Safe ignore
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: title,
            body: options?.body || '',
            channelId: options?.channelId || 'connexa_messages_channel',
            smallIcon: 'ic_launcher',
            iconColor: '#2563EB',
            extra: options?.data || {},
            actionTypeId: 'OPEN_CHAT',
            schedule: { at: new Date(Date.now() + 50) },
          }
        ]
      });

      return;
    } catch (err) {
      console.warn('Error scheduling native notification:', err);
    }
  }

  // B. Standard Web / Service Worker Notification
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      const defaultIcon = 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa';
      const notificationIcon = options?.icon || defaultIcon;

      if (!swRegistration && 'serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.ready.catch(() => null);
      }

      if (swRegistration && 'showNotification' in swRegistration) {
        await swRegistration.showNotification(title, {
          body: options?.body || '',
          icon: notificationIcon,
          badge: notificationIcon,
          tag: options?.tag || 'connexa-notification',
          data: options?.data || {},
          vibrate: [200, 100, 200],
          renotify: true
        } as NotificationOptions & { vibrate?: number[]; renotify?: boolean });
        return;
      }

      // Window Notification Constructor Fallback
      const notification = new Notification(title, {
        body: options?.body || '',
        icon: notificationIcon,
        tag: options?.tag,
        data: options?.data,
      });

      if (options?.onClick) {
        notification.onclick = () => {
          window.focus();
          options.onClick?.();
          notification.close();
        };
      }
    } catch (err) {
      console.warn('Error showing Web Notification:', err);
    }
  }
};

export const sendWebNotification = (
  title: string,
  body?: string,
  icon?: string,
  onClick?: () => void,
  data?: any,
  channelId?: 'connexa_messages_channel' | 'connexa_requests_channel'
) => {
  showWebNotification(title, { body, icon, onClick, data, channelId });
};

// Pure synthetic Web Audio API chime sound generator
let audioCtx: AudioContext | null = null;

export const playNotificationSound = (type: 'message' | 'request' | 'group' | 'accepted' = 'message') => {
  if (typeof window === 'undefined') return;

  try {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
      }
    }

    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (!audioCtx) return;

    const now = audioCtx.currentTime;

    if (type === 'message') {
      // Pleasant dual-frequency soft chime (C5 -> G5)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.12); // G5
      
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);
    } else if (type === 'request') {
      // Upbeat friend request chime (F5 -> A5 -> C6)
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(698.46, now); // F5
      osc.frequency.setValueAtTime(880.00, now + 0.1); // A5
      osc.frequency.setValueAtTime(1046.50, now + 0.2); // C6

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'accepted') {
      // Joyful celebratory harmonic arpeggio (C5 -> E5 -> G5 -> C6)
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = audioCtx!.createOscillator();
        const gain = audioCtx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.14, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

        osc.connect(gain);
        gain.connect(audioCtx!.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
      });
    } else if (type === 'group') {
      // Multi-harmony chord for group activity
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = audioCtx!.createOscillator();
        const gain = audioCtx!.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.08, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx!.destination);
        osc.start(now + idx * 0.05);
        osc.stop(now + 0.4);
      });
    }
  } catch (err) {
    console.warn('Audio feedback failed:', err);
  }
};

export const playNotificationChime = playNotificationSound;

export const testNotification = async () => {
  const perm = await requestNotificationPermission();
  playNotificationSound('accepted');
  if (perm === 'granted') {
    showWebNotification('Connexa Real-Time Alerts 🔔', {
      body: 'Real-time notifications are enabled & active on your phone!',
      icon: 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa-test',
      channelId: 'connexa_messages_channel'
    });
  }
};

// Notification service providing Web Push Notifications, Sound Chimes (via Web Audio API), and Permission Management

export type NotificationPermissionState = 'granted' | 'denied' | 'default';

export const getNotificationPermission = (): NotificationPermissionState => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission as NotificationPermissionState;
};

export const requestNotificationPermission = async (): Promise<NotificationPermissionState> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission as NotificationPermissionState;
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return 'denied';
  }
};

export const showWebNotification = (
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    onClick?: () => void;
  }
) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, {
        body: options?.body || '',
        icon: options?.icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=connexa',
        tag: options?.tag,
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
  onClick?: () => void
) => {
  showWebNotification(title, { body, icon, onClick });
};

// Pure synthetic Web Audio API chime sound generator (no external files needed)
let audioCtx: AudioContext | null = null;

export const playNotificationSound = (type: 'message' | 'request' | 'group' = 'message') => {
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


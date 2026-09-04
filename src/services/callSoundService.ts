// Pure Web Audio API Sound Generator for Real-Time Calling (Ringtones, Chimes, Ended tone)

let audioCtx: AudioContext | null = null;
let outgoingInterval: any = null;
let incomingInterval: any = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (e) {
    console.warn('Could not initialize AudioContext for call sounds:', e);
    return null;
  }
}

// 1. WhatsApp / Telephone Outgoing Ringing Sound ("brrr-brrr..... brrr-brrr.....")
export const startOutgoingRingTone = () => {
  stopCallSounds();
  const ctx = getAudioContext();
  if (!ctx) return;

  const playRingBurst = () => {
    try {
      const now = ctx.currentTime;
      // Dual tone: 440 Hz + 480 Hz (Standard US/UK ringback tone)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.setValueAtTime(0.08, now + 1.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.8);
      osc2.stop(now + 1.8);
    } catch (e) {
      console.warn('Outgoing ringtone error:', e);
    }
  };

  playRingBurst();
  outgoingInterval = setInterval(playRingBurst, 3500);
};

// 2. WhatsApp-style Musical Catchy Incoming Call Ringtone
export const startIncomingRingTone = () => {
  stopCallSounds();
  const ctx = getAudioContext();
  if (!ctx) return;

  const playIncomingTune = () => {
    try {
      const notes = [
        { freq: 523.25, time: 0, dur: 0.14 },    // C5
        { freq: 659.25, time: 0.16, dur: 0.14 }, // E5
        { freq: 783.99, time: 0.32, dur: 0.18 }, // G5
        { freq: 1046.50, time: 0.52, dur: 0.22 },// C6
        { freq: 783.99, time: 0.76, dur: 0.14 }, // G5
        { freq: 1046.50, time: 0.92, dur: 0.35 },// C6
      ];

      notes.forEach(({ freq, time, dur }) => {
        const start = ctx.currentTime + time;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + dur + 0.05);
      });
    } catch (e) {
      console.warn('Incoming ringtone error:', e);
    }
  };

  playIncomingTune();
  incomingInterval = setInterval(playIncomingTune, 2400);
};

// 3. Call Connected Harmonic Chime
export const playCallConnectedTone = () => {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);

      gain.gain.setValueAtTime(0.1, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.25);
    });
  } catch (e) {
    console.warn('Connected chime error:', e);
  }
};

// 4. Call Ended Soft Double Drop Tone
export const playCallEndedTone = () => {
  stopCallSounds();
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [440, 330].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.16);

      gain.gain.setValueAtTime(0.1, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.2);
    });
  } catch (e) {
    console.warn('Call ended chime error:', e);
  }
};

// 5. Stop All Continuous Sound Oscillators
export const stopCallSounds = () => {
  if (outgoingInterval) {
    clearInterval(outgoingInterval);
    outgoingInterval = null;
  }
  if (incomingInterval) {
    clearInterval(incomingInterval);
    incomingInterval = null;
  }
};

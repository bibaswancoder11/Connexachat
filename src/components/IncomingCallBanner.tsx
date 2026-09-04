import React, { useEffect } from 'react';
import { Phone, PhoneOff, Video, Mic } from 'lucide-react';
import { CallSession } from '../types';
import { startIncomingRingTone, stopCallSounds } from '../services/callSoundService';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

interface IncomingCallBannerProps {
  call: CallSession;
  onAccept: (call: CallSession) => void;
  onDecline: (call: CallSession) => void;
}

export const IncomingCallBanner: React.FC<IncomingCallBannerProps> = ({
  call,
  onAccept,
  onDecline
}) => {
  const isVideo = call.type === 'video';

  useEffect(() => {
    // Start incoming ringtone sound
    startIncomingRingTone();

    // Trigger haptic vibration on mobile
    if (Capacitor.isNativePlatform()) {
      try {
        Haptics.notification({ type: NotificationType.Warning });
      } catch (e) {
        // ignore
      }
    }

    return () => {
      stopCallSounds();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-3xl shadow-2xl p-4 sm:p-5 text-white pointer-events-auto ring-1 ring-white/10">
        <div className="flex items-center gap-4">
          {/* Caller Avatar with pulsing radar ring */}
          <div className="relative shrink-0">
            <span className="absolute -inset-1 rounded-2xl bg-emerald-500/40 animate-ping" />
            <img
              src={call.callerAvatar}
              alt={call.callerName}
              className="relative w-14 h-14 rounded-2xl object-cover ring-2 ring-emerald-500"
            />
            <div className="absolute -bottom-1 -right-1 p-1 bg-emerald-600 rounded-full text-white shadow-xs">
              {isVideo ? <Video className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </div>
          </div>

          {/* Caller Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-400">
                {isVideo ? 'Incoming Video Call' : 'Incoming Voice Call'}
              </span>
            </div>
            <h4 className="font-bold text-base text-white truncate mt-0.5">
              {call.callerName}
            </h4>
            <p className="text-xs text-slate-400">Connexa Free WebRTC Call</p>
          </div>

          {/* Action Buttons: Decline (Red) & Accept (Green) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                stopCallSounds();
                onDecline(call);
              }}
              className="w-11 h-11 rounded-2xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition-all"
              title="Decline Call"
            >
              <PhoneOff className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                stopCallSounds();
                onAccept(call);
              }}
              className="w-11 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 transition-all animate-pulse"
              title="Accept Call"
            >
              <Phone className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

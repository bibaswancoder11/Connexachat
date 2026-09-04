import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  SwitchCamera, 
  MonitorUp, 
  Minimize2, 
  Maximize2,
  Volume2,
  VolumeX,
  Sparkles
} from 'lucide-react';
import { CallSession, UserProfile } from '../types';
import { 
  RTC_ICE_CONFIG,
  setCallOffer, 
  answerCallSession, 
  endCallSession, 
  rejectCallSession, 
  subscribeToCallSession,
  addIceCandidate, 
  subscribeToIceCandidates,
  logCallInChat 
} from '../services/callService';
import { 
  startOutgoingRingTone, 
  playCallConnectedTone, 
  playCallEndedTone, 
  stopCallSounds 
} from '../services/callSoundService';

// Create a silent audio track fallback so WebRTC connection succeeds even if
// local microphone hardware is absent or permissions are temporarily blocked.
const createSilentAudioTrack = (): MediaStreamTrack | null => {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(dst);
    oscillator.start();
    const track = dst.stream.getAudioTracks()[0];
    if (track) {
      track.enabled = false;
    }
    return track;
  } catch (e) {
    console.warn('Could not create fallback silent audio track:', e);
    return null;
  }
};

interface CallModalProps {
  call: CallSession;
  currentUser: UserProfile;
  isInitiator: boolean;
  onClose: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  call,
  currentUser,
  isInitiator,
  onClose
}) => {
  const isVideo = call.type === 'video';
  const otherPartyName = isInitiator ? call.recipientName : call.callerName;
  const otherPartyAvatar = isInitiator ? call.recipientAvatar : call.callerAvatar;

  // WebRTC references
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Call states
  const [callStatus, setCallStatus] = useState<'ringing' | 'connecting' | 'connected' | 'ended'>(
    isInitiator ? 'ringing' : 'connecting'
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(!isVideo);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [duration, setDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const timerRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);

  // Format call duration MM:SS
  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  // 1. Initialize PeerConnection & Media
  useEffect(() => {
    let isCleanedUp = false;

    const setupConnection = async () => {
      try {
        if (isInitiator) {
          startOutgoingRingTone();
        }

        // Auto timeout after 60s if no answer
        timeoutRef.current = setTimeout(() => {
          if (callStatus === 'ringing' || callStatus === 'connecting') {
            handleEndCall('missed');
          }
        }, 60000);

        // A. Create RTCPeerConnection
        const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
        pcRef.current = pc;

        // B. Handle Remote Stream
        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;

        pc.ontrack = (event) => {
          event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
          });
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
          }
        };

        // C. ICE Candidates generation
        pc.onicecandidate = (event) => {
          if (event.candidate && !isCleanedUp) {
            addIceCandidate(
              call.id,
              event.candidate,
              isInitiator ? 'caller' : 'recipient'
            );
          }
        };

        // D. Acquire Local Media (Microphone +/- Camera) with resilient fallback
        let stream: MediaStream | null = null;
        try {
          if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true
                },
                video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
              });
            } catch (mediaErr: any) {
              console.warn('Could not acquire full media, trying audio only:', mediaErr?.message || mediaErr);
              setIsVideoDisabled(true);
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true
                }
              });
            }
          }
        } catch (audioErr: any) {
          console.warn('Microphone permission blocked or unavailable:', audioErr?.message || audioErr);
          setPermissionError('Microphone or camera permission was blocked. You are in listen-only mode.');
          setIsMuted(true);
        }

        if (isCleanedUp) {
          if (stream) {
            stream.getTracks().forEach(t => t.stop());
          }
          return;
        }

        // Fallback: If no real audio track could be acquired (e.g. permission denied or missing device),
        // use a synthetic silent track so the WebRTC connection can still negotiate and connect
        if (!stream || stream.getAudioTracks().length === 0) {
          const silentTrack = createSilentAudioTrack();
          if (silentTrack) {
            stream = new MediaStream([silentTrack]);
            setIsMuted(true);
          } else {
            stream = new MediaStream();
          }
        }

        localStreamRef.current = stream;
        if (localVideoRef.current && isVideo && stream.getVideoTracks().length > 0) {
          localVideoRef.current.srcObject = stream;
        }

        // Add local tracks or transceivers to connection
        if (stream.getTracks().length > 0) {
          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream!);
          });
        } else {
          // If no local tracks could be created, configure transceivers to receive remote streams
          if (typeof pc.addTransceiver === 'function') {
            pc.addTransceiver('audio', { direction: 'recvonly' });
            if (isVideo) {
              pc.addTransceiver('video', { direction: 'recvonly' });
            }
          }
        }

        // E. Role-specific SDP Exchange
        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await setCallOffer(call.id, offer);

          // Listen for remote ICE candidates from recipient
          subscribeToIceCandidates(call.id, 'recipient', async (candidateInit) => {
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
              } catch (e) {
                console.warn('Error adding recipient candidate:', e);
              }
            }
          });
        } else {
          // Answering incoming call
          if (call.offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await answerCallSession(call.id, answer);

            // Listen for remote ICE candidates from caller
            subscribeToIceCandidates(call.id, 'caller', async (candidateInit) => {
              if (pc.remoteDescription) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
                } catch (e) {
                  console.warn('Error adding caller candidate:', e);
                }
              }
            });
          }
        }
      } catch (err: any) {
        console.warn('Call initialization warning:', err);
        setPermissionError(err?.message || 'Call initialization encountered an issue.');
      }
    };

    setupConnection();

    // 2. Subscribe to Firestore Call Doc Updates
    const unsubCall = subscribeToCallSession(call.id, async (updatedCall) => {
      if (!updatedCall) return;

      if (updatedCall.status === 'connected') {
        stopCallSounds();
        setCallStatus('connected');
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // If caller, set remote answer SDP
        if (isInitiator && updatedCall.answer && pcRef.current && !pcRef.current.remoteDescription) {
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(updatedCall.answer));
            playCallConnectedTone();
          } catch (e) {
            console.warn('Error setting remote description on caller:', e);
          }
        }

        // Start duration counter
        if (!timerRef.current) {
          timerRef.current = setInterval(() => {
            setDuration(prev => prev + 1);
          }, 1000);
        }
      } else if (
        updatedCall.status === 'ended' ||
        updatedCall.status === 'rejected' ||
        updatedCall.status === 'missed'
      ) {
        handleRemoteTerminated(updatedCall.status);
      }
    });

    return () => {
      isCleanedUp = true;
      unsubCall();
      cleanUpCall();
    };
  }, []);

  const cleanUpCall = () => {
    stopCallSounds();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const handleRemoteTerminated = (status: string) => {
    cleanUpCall();
    playCallEndedTone();
    setCallStatus('ended');
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  // User presses End Call button
  const handleEndCall = async (reason: 'ended' | 'rejected' | 'missed' = 'ended') => {
    const finalDuration = duration;
    cleanUpCall();
    playCallEndedTone();
    setCallStatus('ended');

    try {
      if (reason === 'rejected') {
        await rejectCallSession(call.id);
        await logCallInChat(call.chatId, call, 'rejected', 0);
      } else {
        await endCallSession(call.id, finalDuration);
        await logCallInChat(call.chatId, call, reason, finalDuration);
      }
    } catch (e) {
      console.warn('Error updating call document on end:', e);
    }

    setTimeout(() => {
      onClose();
    }, 800);
  };

  // Request or retry microphone and camera permissions interactively
  const requestMediaPermissions = async () => {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('Media devices are not accessible in this browser context.');
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
      });

      // Hot-swap audio track into existing WebRTC sender
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (newAudioTrack && pcRef.current) {
        const audioSender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (audioSender) {
          await audioSender.replaceTrack(newAudioTrack);
        } else {
          pcRef.current.addTrack(newAudioTrack, newStream);
        }
      }

      // Hot-swap video track if video call
      if (isVideo) {
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack && pcRef.current) {
          const videoSender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(newVideoTrack);
          } else {
            pcRef.current.addTrack(newVideoTrack, newStream);
          }
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = newStream;
          }
          setIsVideoDisabled(false);
        }
      }

      localStreamRef.current = newStream;
      setPermissionError(null);
      setIsMuted(false);
    } catch (err: any) {
      console.warn('Requesting media permissions failed:', err);
      setPermissionError(
        err?.name === 'NotAllowedError' || err?.message?.toLowerCase().includes('denied')
          ? 'Microphone or camera permission was blocked by the browser. Please allow permissions in your address bar.'
          : err?.message || 'Could not acquire media device.'
      );
    }
  };

  // Toggle Microphone
  const toggleMute = async () => {
    if (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0 || permissionError) {
      await requestMediaPermissions();
      return;
    }
    const audioTracks = localStreamRef.current.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsMuted(!isMuted);
  };

  // Toggle Video Camera
  const toggleVideo = async () => {
    if (!localStreamRef.current || localStreamRef.current.getVideoTracks().length === 0) {
      await requestMediaPermissions();
      return;
    }
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoDisabled(!isVideoDisabled);
    }
  };

  // Flip Mobile Camera (Front / Rear)
  const flipCamera = async () => {
    if (!localStreamRef.current || !pcRef.current || !isVideo) return;
    try {
      const nextFacing = facingMode === 'user' ? 'environment' : 'user';
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      const sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      // Stop old track
      localStreamRef.current.getVideoTracks().forEach(t => t.stop());
      localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
      localStreamRef.current.addTrack(newVideoTrack);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setFacingMode(nextFacing);
    } catch (err) {
      console.warn('Could not switch camera:', err);
    }
  };

  // Toggle Screen Share
  const toggleScreenShare = async () => {
    if (!pcRef.current) return;
    try {
      if (!isSharingScreen) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];

        const sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        }

        screenTrack.onended = () => {
          toggleScreenShare(); // revert when user stops sharing via browser bar
        };

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = displayStream;
        }
        setIsSharingScreen(true);
      } else {
        // Revert back to webcam
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const camTrack = camStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(camTrack);
        }
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        setIsSharingScreen(false);
      }
    } catch (e) {
      console.warn('Screen share cancelled or unsupported:', e);
    }
  };

  // Toggle Speaker
  const toggleSpeaker = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !isSpeakerMuted;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !isSpeakerMuted;
    }
    setIsSpeakerMuted(!isSpeakerMuted);
  };

  // ================= MINIMIZED FLOATING PILL =================
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl p-3 flex items-center gap-3 text-white ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-150">
        <div className="relative">
          <img
            src={otherPartyAvatar}
            alt={otherPartyName}
            className="w-10 h-10 rounded-xl object-cover ring-2 ring-emerald-500"
          />
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full ring-2 ring-slate-900 animate-pulse" />
        </div>

        <div className="min-w-0 pr-1">
          <p className="text-xs font-bold truncate max-w-[110px]">{otherPartyName}</p>
          <p className="text-[11px] font-mono text-emerald-400">
            {callStatus === 'connected' ? formatDuration(duration) : 'Calling...'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 border-l border-slate-700 pl-2">
          <button
            type="button"
            onClick={toggleMute}
            className={`p-2 rounded-xl transition-colors ${
              isMuted ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-colors"
            title="Expand Call"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleEndCall('ended')}
            className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition-colors"
            title="End Call"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>

        {/* Hidden Audio element for remote sound */}
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>
    );
  }

  // ================= FULL SCREEN CALL VIEW =================
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-between text-white overflow-hidden animate-in fade-in duration-200">
      {/* Hidden audio element for voice audio */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Header Bar */}
      <div className="w-full px-4 py-4 md:px-8 flex items-center justify-between z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-slate-800/80 backdrop-blur-md border border-slate-700/60 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${callStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400 animate-ping'}`} />
            <span>
              {callStatus === 'connected' 
                ? formatDuration(duration) 
                : callStatus === 'ringing' 
                  ? 'Ringing...' 
                  : callStatus === 'ended' 
                    ? 'Call Ended' 
                    : 'Connecting...'}
            </span>
          </span>

          <span className="hidden sm:inline-block px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 text-[11px] font-medium border border-blue-500/30">
            Free WebRTC P2P
          </span>
        </div>

        {/* Minimize Button */}
        <button
          type="button"
          onClick={() => setIsMinimized(true)}
          className="p-2.5 rounded-full bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-all backdrop-blur-md border border-slate-700/60"
          title="Minimize Call to Chat"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      </div>

      {/* Permission Error / Listen-only Mode Banner */}
      {permissionError && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-3 z-20 max-w-xl animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🎙️</span>
            <span>{permissionError}</span>
          </div>
          <button
            type="button"
            onClick={requestMediaPermissions}
            className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors shadow-xs shrink-0"
          >
            Enable Mic / Retry
          </button>
        </div>
      )}

      {/* Main Body: Video or Audio Experience */}
      <div className="flex-1 w-full flex flex-col items-center justify-center relative p-4 z-10">
        {isVideo ? (
          // ================= VIDEO CALL EXPERIENCE =================
          <div className="w-full h-full max-w-5xl rounded-3xl overflow-hidden relative bg-slate-900 border border-slate-800 flex items-center justify-center shadow-2xl">
            {/* Remote Fullscreen Video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Remote Video Fallback if remote video track is off / not connected */}
            {callStatus !== 'connected' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-md space-y-4">
                <div className="relative">
                  <span className="absolute -inset-4 rounded-full bg-blue-500/20 animate-ping" />
                  <img
                    src={otherPartyAvatar}
                    alt={otherPartyName}
                    className="relative w-28 h-28 rounded-3xl object-cover ring-4 ring-blue-500 shadow-2xl"
                  />
                </div>
                <h3 className="text-xl font-bold text-white">{otherPartyName}</h3>
                <p className="text-sm text-slate-400">
                  {callStatus === 'ringing' ? 'Calling on Connexa...' : 'Establishing peer connection...'}
                </p>
              </div>
            )}

            {/* Picture-in-Picture Local Video Preview (Draggable corner) */}
            <div className="absolute top-4 right-4 w-28 sm:w-44 aspect-3/4 rounded-2xl overflow-hidden bg-slate-800 border-2 border-slate-700 shadow-2xl z-20">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''} ${isVideoDisabled ? 'hidden' : ''}`}
              />
              {isVideoDisabled && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-400 p-2 text-center">
                  <VideoOff className="w-6 h-6 mb-1 text-slate-500" />
                  <span className="text-[10px] font-semibold">Camera Off</span>
                </div>
              )}
              {isSharingScreen && (
                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-blue-600 text-[10px] font-bold text-white">
                  Screen
                </div>
              )}
            </div>
          </div>
        ) : (
          // ================= AUDIO / VOICE CALL EXPERIENCE =================
          <div className="flex flex-col items-center justify-center space-y-6 max-w-sm w-full text-center">
            {/* Animated Pulsing Wave Avatar */}
            <div className="relative flex items-center justify-center">
              <span className={`absolute -inset-8 rounded-full bg-emerald-500/10 ${callStatus === 'connected' ? 'animate-pulse' : 'animate-ping'}`} />
              <span className="absolute -inset-4 rounded-full bg-emerald-500/20" />
              <img
                src={otherPartyAvatar}
                alt={otherPartyName}
                className="relative w-36 h-36 rounded-full object-cover ring-4 ring-emerald-500/80 shadow-2xl"
              />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold text-white tracking-tight">{otherPartyName}</h2>
              <p className="text-sm font-medium text-emerald-400">
                {callStatus === 'connected' ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>In Call • {formatDuration(duration)}</span>
                  </span>
                ) : callStatus === 'ringing' ? (
                  'Ringing...'
                ) : (
                  'Connecting...'
                )}
              </p>
              <p className="text-xs text-slate-500">End-to-End P2P Audio • Opus HD Quality</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Control Bar (WhatsApp Style) */}
      <div className="w-full p-6 pb-8 md:pb-8 flex items-center justify-center gap-3 sm:gap-4 z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        {/* Toggle Microphone */}
        <button
          type="button"
          onClick={toggleMute}
          className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md shadow-lg ${
            isMuted 
              ? 'bg-rose-500 text-white shadow-rose-500/30' 
              : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60'
          }`}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {/* Video Call Controls */}
        {isVideo && (
          <>
            {/* Toggle Camera */}
            <button
              type="button"
              onClick={toggleVideo}
              className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md shadow-lg ${
                isVideoDisabled 
                  ? 'bg-rose-500 text-white shadow-rose-500/30' 
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60'
              }`}
              title={isVideoDisabled ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {isVideoDisabled ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            </button>

            {/* Flip Camera */}
            <button
              type="button"
              onClick={flipCamera}
              className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center justify-center transition-all backdrop-blur-md border border-slate-700/60 shadow-lg"
              title="Flip Camera (Front / Rear)"
            >
              <SwitchCamera className="w-6 h-6" />
            </button>

            {/* Share Screen */}
            <button
              type="button"
              onClick={toggleScreenShare}
              className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md shadow-lg ${
                isSharingScreen 
                  ? 'bg-blue-600 text-white shadow-blue-600/30' 
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60'
              }`}
              title={isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
            >
              <MonitorUp className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Toggle Speaker Output */}
        <button
          type="button"
          onClick={toggleSpeaker}
          className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md shadow-lg ${
            isSpeakerMuted 
              ? 'bg-amber-500 text-white shadow-amber-500/30' 
              : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60'
          }`}
          title={isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
        >
          {isSpeakerMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>

        {/* End Call Button (Prominent Red Button) */}
        <button
          type="button"
          onClick={() => handleEndCall('ended')}
          className="w-15 h-15 sm:w-16 sm:h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center transition-all shadow-xl shadow-rose-600/40"
          title="End Call"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};

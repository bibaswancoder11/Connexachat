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
  Sparkles,
  PenTool,
  Image as ImageIcon,
  Youtube,
  Smartphone,
  X,
  Layers,
  Check,
  RefreshCw,
  Share2
} from 'lucide-react';
import { CallSession, UserProfile } from '../types';
import { InCallShareStudio, InCallShareType } from './InCallShareStudio';
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
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [currentCameraId, setCurrentCameraId] = useState<string>('');
  const [isMirrored, setIsMirrored] = useState(true);
  const [showSharePicker, setShowSharePicker] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [inCallShareType, setInCallShareType] = useState<InCallShareType | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isSwappedView, setIsSwappedView] = useState(false);
  const [callToast, setCallToast] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const toastTimerRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);

  const showCallToast = (msg: string) => {
    setCallToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setCallToast(null);
    }, 2800);
  };

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
          if (event.streams && event.streams[0]) {
            event.streams[0].getTracks().forEach((track) => {
              if (!remoteStream.getTracks().some(t => t.id === track.id)) {
                remoteStream.addTrack(track);
              }
            });
          } else if (event.track) {
            if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
              remoteStream.addTrack(event.track);
            }
          }
          if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
          if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStream) {
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

        // Initialize camera device settings from acquired stream
        const initialVideoTrack = stream.getVideoTracks()[0];
        if (initialVideoTrack) {
          try {
            const settings = initialVideoTrack.getSettings ? initialVideoTrack.getSettings() : {};
            if (settings.deviceId) setCurrentCameraId(settings.deviceId);
            if (settings.facingMode) {
              setFacingMode(settings.facingMode as any);
              setIsMirrored(settings.facingMode === 'user');
            }
          } catch (e) {
            // ignore
          }
        }

        // Add local tracks to connection
        if (stream.getTracks().length > 0) {
          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream!);
          });
        }

        // For video calls, ALWAYS guarantee a video transceiver or sender exists
        // so SDP offer/answer negotiates the m=video channel even if camera is off or pending
        if (isVideo) {
          const hasVideoSender = pc.getSenders().some(s => s.track && s.track.kind === 'video');
          if (!hasVideoSender && typeof pc.addTransceiver === 'function') {
            pc.addTransceiver('video', { direction: 'sendrecv' });
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

  // Helper to reliably find active or allocated video sender in RTCPeerConnection
  const getVideoSender = (): RTCRtpSender | null => {
    if (!pcRef.current) return null;
    const senders = pcRef.current.getSenders();
    // A. Direct video track match
    const activeVideoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (activeVideoSender) return activeVideoSender;

    // B. Transceiver match (for video channel allocated via addTransceiver even if track is null)
    const transceivers = pcRef.current.getTransceivers();
    const videoTransceiver = transceivers.find(t => 
      t.receiver?.track?.kind === 'video' || (t.sender && (t.sender as any).trackKind === 'video')
    );
    if (videoTransceiver && videoTransceiver.sender) {
      return videoTransceiver.sender;
    }

    // C. Any sender with no track attached yet
    const emptySender = senders.find(s => !s.track);
    if (emptySender) return emptySender;

    return null;
  };

  // Detect if native browser OS screen capture is supported
  const isNativeDisplayMediaSupported = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return !!(
      (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') ||
      typeof (navigator as any).getDisplayMedia === 'function'
    );
  };

  // Flip Mobile Camera (Front / Rear) or Cycle Webcams / Toggle Mirror Mode
  const flipCamera = async () => {
    if (!isVideo || isSwitchingCamera) return;
    setIsSwitchingCamera(true);

    try {
      // If camera was muted / disabled, turn it on
      if (isVideoDisabled) {
        setIsVideoDisabled(false);
      }

      // If screen sharing was active, restore camera first
      if (isSharingScreen || isStudioOpen) {
        await stopScreenShare();
      }

      // 1. Enumerate available video devices
      let videoDevices: MediaDeviceInfo[] = [];
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = devices.filter(d => d.kind === 'videoinput');
        }
      } catch (enumErr) {
        console.warn('Enumerate devices warning:', enumErr);
      }

      const nextFacing: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';

      // Find the best matching next device ID if multiple physical cameras exist
      let targetDeviceId: string | null = null;
      if (videoDevices.length > 1) {
        const targetKeywords = nextFacing === 'environment' 
          ? ['back', 'rear', 'environment', 'outer', 'world', 'main']
          : ['front', 'user', 'face', 'selfie', 'inner'];

        const matchedDevice = videoDevices.find(d => {
          const label = (d.label || '').toLowerCase();
          return targetKeywords.some(kw => label.includes(kw)) && d.deviceId && d.deviceId !== currentCameraId;
        });

        if (matchedDevice && matchedDevice.deviceId) {
          targetDeviceId = matchedDevice.deviceId;
        } else {
          // If no keyword match, cycle to next available video device
          const currentIndex = videoDevices.findIndex(d => d.deviceId === currentCameraId);
          const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % videoDevices.length : 1;
          targetDeviceId = videoDevices[nextIndex]?.deviceId || null;
        }
      }

      // 2. CRITICAL: Stop previous video tracks first to release Android / iOS camera hardware lock
      if (localStreamRef.current) {
        const oldTracks = localStreamRef.current.getVideoTracks();
        oldTracks.forEach(t => {
          try { t.stop(); } catch (e) {}
        });
      }

      // 3. Acquire new stream with robust prioritized fallbacks
      let newStream: MediaStream | null = null;

      // Attempt A: Explicit target device ID (if multi-camera device detected)
      if (targetDeviceId) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: targetDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
        } catch (errA) {
          console.log('Target deviceId acquisition failed, falling back to facingMode:', errA);
        }
      }

      // Attempt B: Exact target facingMode
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { exact: nextFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
        } catch (errB) {
          console.log('Exact facingMode failed, falling back to ideal facingMode:', errB);
        }
      }

      // Attempt C: Ideal target facingMode
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: nextFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
        } catch (errC) {
          console.log('Ideal facingMode failed, falling back to general video:', errC);
        }
      }

      // Attempt D: Fallback to any available video stream
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (errD) {
          console.warn('All video acquisition attempts failed:', errD);
        }
      }

      // 4. Connect new video track if acquired
      if (newStream && newStream.getVideoTracks().length > 0) {
        const newVideoTrack = newStream.getVideoTracks()[0];
        const settings = newVideoTrack.getSettings ? newVideoTrack.getSettings() : {};
        const acquiredDeviceId = settings.deviceId || targetDeviceId || '';

        // If only 1 camera device physically exists on machine, toggle mirror mode
        const isSingleDevice = videoDevices.length <= 1 || (currentCameraId && acquiredDeviceId === currentCameraId);

        let finalFacing = nextFacing;
        if (settings.facingMode) {
          finalFacing = settings.facingMode as any;
        } else if (isSingleDevice) {
          finalFacing = facingMode;
        }

        const shouldMirror = isSingleDevice ? !isMirrored : (finalFacing === 'user');
        setFacingMode(finalFacing);
        if (acquiredDeviceId) setCurrentCameraId(acquiredDeviceId);
        setIsMirrored(shouldMirror);
        setIsVideoDisabled(false);

        // Hot-swap video track into WebRTC peer connection
        if (pcRef.current) {
          const videoSender = getVideoSender();
          if (videoSender) {
            await videoSender.replaceTrack(newVideoTrack);
          } else {
            pcRef.current.addTrack(newVideoTrack, newStream);
          }
        }

        // Update localStreamRef (preserving existing audio tracks)
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => {
            try { localStreamRef.current?.removeTrack(t); } catch (e) {}
          });
          localStreamRef.current.addTrack(newVideoTrack);
        } else {
          localStreamRef.current = newStream;
        }

        // Update local preview element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([newVideoTrack]);
          localVideoRef.current.play().catch(() => {});
        }

        if (isSingleDevice) {
          showCallToast(shouldMirror ? 'Selfie Mode (Mirrored)' : 'Normal View (Unmirrored)');
        } else {
          const cameraLabel = finalFacing === 'environment' ? 'Rear (Back) Camera' : 'Front (Selfie) Camera';
          showCallToast(`Switched to ${cameraLabel}`);
        }
      } else {
        // Fallback: Toggle mirror mode so button gives immediate visual feedback
        setIsMirrored(prev => !prev);
        showCallToast('Toggled Camera Mirror Mode');
      }
    } catch (err: any) {
      console.warn('Could not switch camera:', err);
      setIsMirrored(prev => !prev);
      showCallToast('Toggled Camera Mirror Mode');
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  // Toggle Screen Share or In-Call Share Studio
  const toggleScreenShare = async () => {
    if (isSharingScreen || isStudioOpen) {
      await stopScreenShare();
      return;
    }
    // Launch screen sharing directly!
    await handleStartNativeScreenShare();
  };

  // Launch Native Browser Screen Capture with intelligent automatic studio fallback
  const handleStartNativeScreenShare = async () => {
    if (isStartingScreenShare) return;
    setIsStartingScreenShare(true);
    setShowSharePicker(false);

    try {
      const getDisplay = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices) || 
        (navigator as any).getDisplayMedia?.bind(navigator);

      if (!getDisplay) {
        showCallToast('Screen capture restricted by device. Opening Live Whiteboard!');
        setInCallShareType('whiteboard');
        setIsStudioOpen(true);
        setIsSwappedView(true);
        return;
      }

      let displayStream: MediaStream | null = null;
      try {
        displayStream = await getDisplay({
          video: {
            cursor: 'always',
            displaySurface: 'monitor'
          } as any,
          audio: false
        });
      } catch (err: any) {
        const errMsg = (err?.message || '').toLowerCase();
        // User clicked "Cancel" in browser picker dialog
        if (
          err?.name === 'AbortError' ||
          errMsg.includes('cancel') ||
          errMsg.includes('dismissed')
        ) {
          showCallToast('Screen share cancelled');
          return;
        }

        // Browser or iframe policy blocked getDisplayMedia
        if (
          err?.name === 'NotAllowedError' || 
          errMsg.includes('denied') || 
          errMsg.includes('not allowed') ||
          err?.name === 'SecurityError' ||
          err?.name === 'NotSupportedError'
        ) {
          console.warn('OS capture restricted. Falling back to Live Whiteboard stream:', err);
          showCallToast('OS capture restricted. Streaming Live Whiteboard!');
          setInCallShareType('whiteboard');
          setIsStudioOpen(true);
          setIsSwappedView(true);
          return;
        }

        throw err;
      }

      const screenTrack = displayStream?.getVideoTracks()[0];
      if (!screenTrack) {
        showCallToast('No screen selected');
        return;
      }

      screenStreamRef.current = displayStream;

      // When user clicks native browser "Stop Sharing" floating bar
      screenTrack.onended = () => {
        stopScreenShare();
      };

      // Hot-swap screen track into WebRTC peer connection
      if (pcRef.current) {
        const videoSender = getVideoSender();
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        } else {
          pcRef.current.addTrack(screenTrack, displayStream);
        }
      }

      // Update local preview with screen track
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([screenTrack]);
        localVideoRef.current.play().catch(() => {});
      }

      setIsSharingScreen(true);
      setIsVideoDisabled(false);
      setIsSwappedView(true); // Bring shared screen to primary view
      showCallToast('Screen sharing started');
    } catch (err: any) {
      console.warn('Screen share failed:', err);
      showCallToast('Opening Live Whiteboard Studio...');
      setInCallShareType('whiteboard');
      setIsStudioOpen(true);
      setIsSwappedView(true);
    } finally {
      setIsStartingScreenShare(false);
    }
  };

  // Launch In-Call Share Studio (Whiteboard, Photo Presentation, or YouTube)
  const handleStartInCallStudio = (type: InCallShareType) => {
    setShowSharePicker(false);
    setInCallShareType(type);
    setIsStudioOpen(true);
    setIsSwappedView(true);
  };

  // Connect In-Call Studio Canvas Stream into WebRTC
  const handleStudioStreamReady = async (stream: MediaStream, type: InCallShareType) => {
    const canvasTrack = stream.getVideoTracks()[0];
    if (!canvasTrack) return;

    screenStreamRef.current = stream;

    // Hot-swap canvas track into WebRTC peer connection
    if (pcRef.current) {
      const videoSender = getVideoSender();
      if (videoSender) {
        await videoSender.replaceTrack(canvasTrack);
      } else {
        pcRef.current.addTrack(canvasTrack, stream);
      }
    }

    // Update local preview
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = new MediaStream([canvasTrack]);
      localVideoRef.current.play().catch(() => {});
    }

    setIsSharingScreen(true);
    setIsVideoDisabled(false);
    showCallToast(`Live ${type === 'whiteboard' ? 'Whiteboard' : type === 'photo' ? 'Photo' : 'Media'} streaming`);
  };

  // Cleanly Stop Screen Share or In-Call Studio and Restore Camera
  const stopScreenShare = async () => {
    setIsSharingScreen(false);
    setIsStudioOpen(false);
    setInCallShareType(null);
    setIsSwappedView(false);

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    try {
      // Re-acquire camera stream
      let camStream: MediaStream | null = null;
      try {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: currentCameraId 
            ? { deviceId: { ideal: currentCameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode } }
          });
        } catch {
          camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }

      const camTrack = camStream?.getVideoTracks()[0];
      if (camTrack) {
        if (pcRef.current) {
          const videoSender = getVideoSender();
          if (videoSender) {
            await videoSender.replaceTrack(camTrack);
          }
        }

        if (localStreamRef.current) {
          const oldTracks = localStreamRef.current.getVideoTracks();
          oldTracks.forEach(t => {
            try {
              t.stop();
              localStreamRef.current?.removeTrack(t);
            } catch (e) {}
          });
          localStreamRef.current.addTrack(camTrack);
        } else {
          localStreamRef.current = camStream;
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([camTrack]);
          localVideoRef.current.play().catch(() => {});
        }
      }
      showCallToast('Screen sharing stopped');
    } catch (err) {
      console.warn('Could not restore camera stream after screen share:', err);
      showCallToast('Screen sharing stopped');
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

      {/* In-Call Toast Notification for Camera Flip & Screen Share feedback */}
      {callToast && (
        <div className="absolute top-18 z-50 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 text-white rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{callToast}</span>
        </div>
      )}

      {/* Main Body: Video or Audio Experience */}
      <div className="flex-1 w-full flex flex-col items-center justify-center relative p-4 z-10">
        {isVideo ? (
          // ================= VIDEO CALL EXPERIENCE =================
          <div className="w-full h-full max-w-5xl rounded-3xl overflow-hidden relative bg-slate-900 border border-slate-800 flex items-center justify-center shadow-2xl">
            {isStudioOpen ? (
              // ================= IN-CALL SCREEN STUDIO (WHITEBOARD / PHOTO / YOUTUBE) =================
              <div className="w-full h-full relative z-10 flex flex-col">
                <InCallShareStudio
                  initialType={inCallShareType || 'whiteboard'}
                  onStreamReady={handleStudioStreamReady}
                  onStopSharing={stopScreenShare}
                  isOtherPartySharing={false}
                />

                {/* Floating remote party video preview so you can see caller reactions while drawing */}
                <div 
                  onClick={() => setIsSwappedView(!isSwappedView)}
                  className="absolute bottom-16 sm:bottom-20 right-3 sm:right-4 w-28 sm:w-36 aspect-3/4 rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-700 shadow-2xl z-20 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                  title="Remote participant (tap to toggle)"
                >
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[9px] font-semibold text-white truncate max-w-[90%]">
                    {otherPartyName}
                  </div>
                </div>
              </div>
            ) : (
              // ================= STANDARD CAMERA & SCREEN SHARE VIEW =================
              <>
                {/* Remote Video Container */}
                <div 
                  onClick={() => {
                    if (isSwappedView) setIsSwappedView(false);
                  }}
                  className={
                    isSwappedView
                      ? 'absolute top-4 right-4 w-28 sm:w-44 aspect-3/4 rounded-2xl overflow-hidden bg-slate-800 border-2 border-slate-700 shadow-2xl z-20 cursor-pointer hover:ring-2 hover:ring-blue-500/50 transition-all'
                      : 'w-full h-full relative flex items-center justify-center'
                  }
                  title={isSwappedView ? 'Tap to expand other party' : undefined}
                >
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`w-full h-full ${isSharingScreen ? 'object-contain bg-black' : 'object-cover'}`}
                  />
                </div>

                {/* Remote Video Fallback if remote video track is off / not connected */}
                {callStatus !== 'connected' && !isSwappedView && (
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

                {/* Local Video Preview Container (Camera or Screen Share) */}
                <div 
                  onClick={() => {
                    if (!isSwappedView) setIsSwappedView(true);
                  }}
                  className={
                    isSwappedView
                      ? 'w-full h-full relative flex items-center justify-center'
                      : 'absolute top-4 right-4 w-28 sm:w-44 aspect-3/4 rounded-2xl overflow-hidden bg-slate-800 border-2 border-slate-700 shadow-2xl z-20 cursor-pointer hover:ring-2 hover:ring-blue-500/50 transition-all'
                  }
                  title={!isSwappedView ? 'Tap to expand your camera/screen' : undefined}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full ${
                      isSharingScreen ? 'object-contain bg-black' : 'object-cover'
                    } ${
                      isMirrored && !isSharingScreen ? '-scale-x-100' : 'scale-x-100'
                    } ${isVideoDisabled ? 'hidden' : ''}`}
                  />
                  {isVideoDisabled && (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-400 p-2 text-center">
                      <VideoOff className="w-6 h-6 mb-1 text-slate-500" />
                      <span className="text-[10px] font-semibold">Camera Off</span>
                    </div>
                  )}
                  {isSharingScreen && !isSwappedView && (
                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded bg-blue-600 text-[10px] font-bold text-white shadow-xs">
                      Screen
                    </div>
                  )}
                </div>
              </>
            )}
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
              disabled={isSwitchingCamera}
              className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center justify-center transition-all backdrop-blur-md border border-slate-700/60 shadow-lg active:scale-95 group ${
                isSwitchingCamera ? 'opacity-70 cursor-wait' : ''
              }`}
              title="Switch Camera (Front / Rear / Mirror Mode)"
            >
              <SwitchCamera className={`w-6 h-6 transition-transform group-hover:rotate-180 duration-300 ${isSwitchingCamera ? 'animate-spin text-blue-400' : ''}`} />
            </button>

            {/* Share Screen (Direct 1-Tap Toggle) */}
            <button
              type="button"
              onClick={toggleScreenShare}
              disabled={isStartingScreenShare}
              className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md shadow-lg active:scale-95 ${
                isSharingScreen || isStudioOpen 
                  ? 'bg-blue-600 text-white shadow-blue-600/40 ring-4 ring-blue-500/40 animate-pulse' 
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60'
              } ${isStartingScreenShare ? 'opacity-70 cursor-wait' : ''}`}
              title={isSharingScreen || isStudioOpen ? 'Stop Sharing Screen' : 'Share Screen (Broadcast Live)'}
            >
              {isStartingScreenShare ? (
                <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              ) : (
                <MonitorUp className="w-6 h-6" />
              )}
            </button>

            {/* In-Call Studio Menu (Whiteboard, Photo, YouTube) */}
            <button
              type="button"
              onClick={() => setShowSharePicker(true)}
              className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center justify-center transition-all backdrop-blur-md border border-slate-700/60 shadow-lg active:scale-95"
              title="More Sharing Options (Whiteboard, Photo Presenter, YouTube)"
            >
              <Layers className="w-5 h-5 text-indigo-400" />
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

      {/* Share Screen & Content Studio Picker Modal */}
      {showSharePicker && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSharePicker(false);
          }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 space-y-4 animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Share Screen & Content</h3>
                  <p className="text-xs text-slate-400">Choose what you want to share with {otherPartyName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSharePicker(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Options List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Native Display / Screen Share */}
              <button
                type="button"
                onClick={handleStartNativeScreenShare}
                className="p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-blue-500/50 flex flex-col items-start gap-2 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <MonitorUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white">Share Screen</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      {isNativeDisplayMediaSupported() ? 'Native' : 'Auto'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Broadcast your full screen, app window, or browser tab
                  </p>
                </div>
              </button>

              {/* Option 2: Live Interactive Whiteboard */}
              <button
                type="button"
                onClick={() => handleStartInCallStudio('whiteboard')}
                className="p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-emerald-500/50 flex flex-col items-start gap-2 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <PenTool className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white">Live Whiteboard</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      30fps
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Draw, write diagrams, and sketch live on video stream
                  </p>
                </div>
              </button>

              {/* Option 3: Present Photo / Document */}
              <button
                type="button"
                onClick={() => handleStartInCallStudio('photo')}
                className="p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-purple-500/50 flex flex-col items-start gap-2 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white">Present Photo</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Markup
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Present images, slides, receipts, with live pen notes
                  </p>
                </div>
              </button>

              {/* Option 4: Watch YouTube Together */}
              <button
                type="button"
                onClick={() => handleStartInCallStudio('youtube')}
                className="p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-rose-500/50 flex flex-col items-start gap-2 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Youtube className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white">YouTube Stream</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Sync
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Watch synchronized YouTube video together during call
                  </p>
                </div>
              </button>
            </div>

            {/* Cancel Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowSharePicker(false)}
                className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold text-xs transition-colors min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

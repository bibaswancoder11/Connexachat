import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Image as ImageIcon, 
  Mic, 
  Square, 
  Smile, 
  Trash2, 
  CheckCheck, 
  X, 
  ShieldAlert,
  Play,
  Pause,
  Users2,
  Info,
  Check,
  ArrowLeft,
  Copy,
  MoreVertical,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  ImageOff,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isUserOnline } from '../services/userService';
import { ChatRoom, ChatMessage, UserProfile } from '../types';
import { compressImage, downloadImageDataUrl } from '../utils/imageUtils';
import { 
  subscribeToMessages, 
  sendMessage, 
  markChatAsRead, 
  setTypingIndicator, 
  toggleMessageReaction, 
  deleteMessage 
} from '../services/chatService';
import { GroupInfoModal } from './GroupInfoModal';
import { EnlargeableAvatar } from './EnlargeableAvatar';

interface ChatViewProps {
  chat: ChatRoom;
  friends: UserProfile[];
  onGroupLeft?: () => void;
  onBackToChats?: () => void;
}

const EMOJI_REACTIONS = ['❤️', '👍', '😂', '🔥', '😮'];

export const ChatView: React.FC<ChatViewProps> = ({ chat, friends, onGroupLeft, onBackToChats }) => {
  const { userProfile } = useAuth();
  const isGroup = chat.isGroup;
  const otherUser = chat.otherUser;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [failedImageIds, setFailedImageIds] = useState<{ [msgId: string]: boolean }>({});

  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null); // messageId
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{ id: string; text: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<any>(null);

  // Keyboard shortcut listener for Lightbox (ESC to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImage) {
        setPreviewImage(null);
        setLightboxZoom(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  // Subscribe to real-time messages
  useEffect(() => {
    if (!chat.id || !userProfile) return;

    // Mark read
    markChatAsRead(chat.id, userProfile.uid);

    const unsubscribe = subscribeToMessages(chat.id, (msgs) => {
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [chat.id, userProfile]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Typing indicator trigger
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (chat.id && userProfile) {
      setTypingIndicator(chat.id, userProfile.uid, e.target.value.length > 0);
    }
  };

  // Process & compress an image file before attaching
  const processAndSetImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (PNG, JPG, WebP, GIF).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      alert('Image file is too large. Please select an image under 15MB.');
      return;
    }
    setIsCompressingImage(true);
    try {
      const compressed = await compressImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.82
      });
      setSelectedImage(compressed);
    } catch (err) {
      console.error('Failed to process image:', err);
      alert('Could not process image. Please try another photo.');
    } finally {
      setIsCompressingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle Image File Input
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAndSetImageFile(file);
    }
  };

  // Clipboard paste image support
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processAndSetImageFile(file);
          break;
        }
      }
    }
  };

  // Drag and drop image handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        processAndSetImageFile(file);
      }
    }
  };

  // Send Text / Image Message
  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !selectedImage) || !userProfile || !chat.id || isCompressingImage) return;

    const textToSend = inputText.trim();
    const imgToSend = selectedImage;

    setInputText('');
    setSelectedImage(null);
    setTypingIndicator(chat.id, userProfile.uid, false);

    try {
      if (imgToSend) {
        await sendMessage(chat.id, userProfile.uid, textToSend, 'image', imgToSend, userProfile);
      } else {
        await sendMessage(chat.id, userProfile.uid, textToSend, 'text', undefined, userProfile);
      }
    } catch (err) {
      console.error('Error sending message:', err);
      alert('Failed to send message. Please check your connection and try again.');
    }
  };

  // Audio Voice Note Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          if (typeof reader.result === 'string' && userProfile && chat.id) {
            await sendMessage(chat.id, userProfile.uid, 'Voice Note', 'audio', reader.result, userProfile);
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      alert('Microphone access is required to send voice notes.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const togglePlayAudio = (msgId: string, url: string) => {
    if (playingAudioId === msgId) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(url);
      audioRef.current = newAudio;
      newAudio.play();
      setPlayingAudioId(msgId);
      newAudio.onended = () => setPlayingAudioId(null);
    }
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Compute active typing users
  const typingUserUids = Object.entries(chat.typing || {})
    .filter(([uid, isTyping]) => isTyping && uid !== userProfile?.uid)
    .map(([uid]) => uid);

  let typingText = '';
  if (typingUserUids.length > 0) {
    if (isGroup) {
      const names = typingUserUids.map(uid => chat.participantProfiles?.[uid]?.displayName || 'Member');
      if (names.length === 1) typingText = `${names[0]} is typing...`;
      else if (names.length === 2) typingText = `${names[0]} & ${names[1]} are typing...`;
      else typingText = `Several members are typing...`;
    } else {
      typingText = `${otherUser?.displayName || 'Friend'} is typing...`;
    }
  }

  const title = isGroup ? (chat.groupName || 'Group Chat') : (otherUser?.displayName || 'Friend');
  const avatarUrl = isGroup
    ? (chat.groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${chat.id}`)
    : (otherUser?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.id}`);

  return (
    <div 
      className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Over Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 bg-blue-600/90 backdrop-blur-xs flex flex-col items-center justify-center text-white space-y-3 p-6 pointer-events-none animate-in fade-in duration-150">
          <div className="p-4 bg-white/20 rounded-full animate-bounce">
            <ImageIcon className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-lg font-bold">Drop Image to Share</h3>
          <p className="text-xs text-blue-100">Release file to attach photo to this chat</p>
        </div>
      )}
      
      {/* Top Chat Header */}
      <div className="px-4 md:px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-2xs z-10">
        <div className="flex items-center gap-2 min-w-0">
          {onBackToChats && (
            <button
              onClick={onBackToChats}
              className="md:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              title="Back to Chats"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-3.5 min-w-0">
            <EnlargeableAvatar
              src={avatarUrl}
              alt={title}
              name={title}
              userProfile={!isGroup ? otherUser : undefined}
              isGroup={isGroup}
              memberCount={chat.participants?.length}
              showStatusBadge={!isGroup}
              showGroupBadge={isGroup}
              sizeClass="w-11 h-11 rounded-2xl"
            />

            <div 
              onClick={() => isGroup && setShowGroupInfoModal(true)}
              className={`min-w-0 ${isGroup ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
            >
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {title}
                </h3>
                {!isGroup && (
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold shrink-0">
                    @{otherUser?.username}{otherUser?.userTag}
                  </span>
                )}
              </div>

            {isGroup ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                <span>{chat.participants?.length || 0} members • Click for info</span>
              </p>
            ) : isUserOnline(otherUser) ? (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Online</span>
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span>Offline</span>
              </p>
            )}
          </div>
        </div>
      </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          {isGroup ? (
            <button
              onClick={() => setShowGroupInfoModal(true)}
              className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-all flex items-center gap-1.5 text-xs font-semibold"
            >
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">Group Info</span>
            </button>
          ) : (
            <button
              title="Encrypted Chat Active"
              className="p-2 text-blue-600 dark:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ShieldAlert className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="p-4 bg-blue-100 dark:bg-blue-950/60 rounded-3xl text-blue-600 dark:text-blue-400">
              <Smile className="w-8 h-8" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {isGroup ? `Welcome to ${title}!` : `Say Hi to ${title}!`}
            </p>
            <p className="text-xs text-slate-400 max-w-xs">
              {isGroup
                ? 'Send your first message to kick off the group conversation.'
                : 'This is the beginning of your direct message history on Connexa.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span className="px-3 py-1 bg-slate-200/70 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[11px] font-medium rounded-full border border-slate-300/50 dark:border-slate-700/50 shadow-2xs">
                    {msg.text}
                  </span>
                </div>
              );
            }

            const isMe = msg.senderId === userProfile?.uid;
            const isGroupAdmin = isGroup && chat.adminUids?.includes(userProfile?.uid || '');
            const canDelete = isMe || isGroupAdmin;
            const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
            const senderProfile = isGroup ? chat.participantProfiles?.[msg.senderId] : null;

            const senderDisplayName = msg.senderName || senderProfile?.displayName || (isMe ? 'You' : 'Member');
            const senderAvatar = msg.senderPhoto || senderProfile?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.senderId}`;

            const readCount = (msg.readBy || []).filter(u => u !== msg.senderId).length;
            const isSelected = selectedMessageId === msg.id;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group relative transition-all duration-150 my-1`}
              >
                <div className="flex items-end gap-1.5 max-w-[88%] sm:max-w-[75%] relative">
                  {!isMe && (
                    <EnlargeableAvatar
                      src={senderAvatar}
                      alt={senderDisplayName}
                      name={senderDisplayName}
                      uid={msg.senderId}
                      userProfile={isGroup ? (senderProfile || undefined) : otherUser}
                      sizeClass="w-8 h-8 rounded-xl"
                      className="shrink-0 mb-1"
                    />
                  )}

                  {/* Message Bubble Container - Tapping selects/highlights */}
                  <div
                    onClick={() => setSelectedMessageId(isSelected ? null : msg.id)}
                    className={`relative p-3.5 rounded-2xl text-xs md:text-sm leading-relaxed space-y-1.5 cursor-pointer transition-all ${
                      isSelected ? 'ring-2 ring-blue-500/90 dark:ring-blue-400/90 shadow-md scale-[1.01]' : 'shadow-2xs hover:shadow-xs'
                    } ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-br-2px'
                        : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200/80 dark:border-slate-700/80 rounded-bl-2px'
                    }`}
                  >
                    {/* Sender Name in Group Chat */}
                    {isGroup && !isMe && (
                      <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 block mb-0.5">
                        {senderDisplayName}
                      </span>
                    )}

                    {/* Image attachment */}
                    {msg.type === 'image' && msg.mediaUrl && (
                      <div className="space-y-1 my-1">
                        {failedImageIds[msg.id] ? (
                          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 flex items-center gap-2 text-slate-500 text-xs">
                            <ImageOff className="w-4 h-4 text-slate-400" />
                            <span>Image unavailable or corrupted</span>
                          </div>
                        ) : (
                          <div
                            className="relative group/img overflow-hidden rounded-xl max-w-xs cursor-pointer border border-slate-200/50 dark:border-slate-700/50 shadow-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewImage(msg.mediaUrl || null);
                              setLightboxZoom(1);
                            }}
                          >
                            <img
                              src={msg.mediaUrl}
                              alt="Attached Media"
                              onError={() => {
                                setFailedImageIds(prev => ({ ...prev, [msg.id]: true }));
                              }}
                              className="w-full max-h-72 object-cover rounded-xl hover:scale-102 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white">
                              <div className="p-2 bg-black/60 rounded-full backdrop-blur-xs">
                                <Maximize2 className="w-4 h-4" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Audio Voice Note */}
                    {msg.type === 'audio' && msg.mediaUrl && (
                      <div className="flex items-center gap-3 p-2 bg-black/10 dark:bg-white/10 rounded-xl min-w-[180px]">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); togglePlayAudio(msg.id, msg.mediaUrl!); }}
                          className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-400 transition-colors shrink-0"
                        >
                          {playingAudioId === msg.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                        <div className="flex-1">
                          <span className="text-xs font-semibold block">Voice Note</span>
                          <span className="text-[10px] opacity-80 font-mono">Audio recording</span>
                        </div>
                      </div>
                    )}

                    {/* Text Message */}
                    {msg.text && (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}

                    {/* Footer Time & Status */}
                    <div className={`flex items-center gap-1.5 justify-end text-[10px] ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>
                      <span>{formatTimestamp(msg.timestamp)}</span>
                      {isMe && (
                        isGroup ? (
                          <span className="text-[9px] font-semibold opacity-90 flex items-center gap-0.5">
                            <CheckCheck className="w-3 h-3 text-blue-100" />
                            {readCount > 0 ? `Read by ${readCount}` : 'Sent'}
                          </span>
                        ) : (
                          <CheckCheck className="w-3 h-3 text-blue-100" />
                        )
                      )}
                    </div>

                    {/* Emoji Reactions display */}
                    {hasReactions && (
                      <div className={`absolute -bottom-3 ${isMe ? 'right-2' : 'left-2'} flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded-full shadow-md text-[11px]`}>
                        {Object.entries(msg.reactions!).map(([uid, emoji]) => (
                          <span key={uid}>{emoji}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions Bar: Visible on hover, tap select, or when reaction picker is open */}
                  <div className={`flex items-center gap-0.5 p-1 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-xs border border-slate-200/80 dark:border-slate-700/80 shadow-md transition-all ${
                    isSelected || showEmojiPicker === msg.id ? 'opacity-100 scale-100' : 'opacity-0 group-hover:opacity-100 scale-95 pointer-events-none group-hover:pointer-events-auto'
                  }`}>
                    {/* React Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id);
                      }}
                      className="p-1.5 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      title="Add reaction"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>

                    {/* Copy Text Button */}
                    {msg.text && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(msg.text);
                          setCopiedMessageId(msg.id);
                          setTimeout(() => setCopiedMessageId(null), 1800);
                        }}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        title="Copy text"
                      >
                        {copiedMessageId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* Delete Button */}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteModal({
                            id: msg.id,
                            text: msg.text || (msg.type === 'image' ? 'Photo attachment' : msg.type === 'audio' ? 'Voice note' : 'Message')
                          });
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title={isMe ? "Delete your message" : "Delete message (Group Admin)"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Emoji Picker Popup */}
                {showEmojiPicker === msg.id && (
                  <div className={`mt-1 z-20 flex gap-1.5 bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 ${isMe ? 'self-end' : 'self-start'}`}>
                    {EMOJI_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          if (userProfile) {
                            toggleMessageReaction(chat.id, msg.id, userProfile.uid, emoji);
                          }
                          setShowEmojiPicker(null);
                        }}
                        className="p-1 text-sm hover:scale-125 transition-transform"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Typing Indicator */}
        {typingText && (
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium italic animate-pulse">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span>{typingText}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Selected Image Preview / Compression indicator before sending */}
      {(selectedImage || isCompressingImage) && (
        <div className="p-3 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-3 min-w-0">
            {isCompressingImage ? (
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              selectedImage && (
                <img src={selectedImage} alt="Selected attachment" className="w-12 h-12 rounded-xl object-cover ring-2 ring-blue-500/30 shrink-0" />
              )
            )}
            <div className="min-w-0">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block truncate">
                {isCompressingImage ? 'Optimizing image...' : 'Image Attached'}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate">
                {isCompressingImage ? 'Compressing for instant sharing' : 'Add optional text caption below and press Send'}
              </span>
            </div>
          </div>
          {!isCompressingImage && selectedImage && (
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
              title="Remove image"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Input Control Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <form onSubmit={handleSendText} onPaste={handlePaste} className="flex items-center gap-2">
          
          {/* File input for images */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isCompressingImage}
            className="p-2.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Attach image (or drag & drop / paste)"
          >
            <ImageIcon className="w-5 h-5" />
          </button>

          {/* Voice Note Button */}
          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              className="p-2.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Record Voice Note"
            >
              <Mic className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 animate-pulse"
            >
              <Square className="w-3.5 h-3.5" />
              <span>{recordingTime}s (Click to send)</span>
            </button>
          )}

          {/* Text input */}
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={isGroup ? `Message ${title}... (paste or drop images)` : `Message ${title}... (paste or drop images)`}
            className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs md:text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedImage) || isCompressingImage}
            className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-md shadow-blue-600/20 transition-all disabled:opacity-40 disabled:shadow-none"
            title="Send Message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Interactive Fullscreen Image Lightbox Modal */}
      {previewImage && (
        <div
          onClick={() => { setPreviewImage(null); setLightboxZoom(1); }}
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-150 cursor-default select-none"
        >
          {/* Lightbox Controls Header */}
          <div className="flex items-center justify-between z-10 w-full max-w-5xl mx-auto bg-slate-900/80 backdrop-blur-md p-3 rounded-2xl border border-white/10 text-white shadow-2xl">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-medium text-slate-200">Shared Image Viewer</span>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setLightboxZoom(z => Math.max(0.5, z - 0.25))}
                className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-slate-400 min-w-[40px] text-center">
                {Math.round(lightboxZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setLightboxZoom(z => Math.min(3, z + 0.25))}
                className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => downloadImageDataUrl(previewImage, `connexa-shared-image-${Date.now()}.jpg`)}
                className="p-2 text-blue-400 hover:text-blue-300 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                title="Download Image"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download</span>
              </button>
              <button
                type="button"
                onClick={() => { setPreviewImage(null); setLightboxZoom(1); }}
                className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-white/10 transition-colors ml-2"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Image Canvas */}
          <div
            className="flex-1 flex items-center justify-center overflow-auto p-4 my-2"
            onClick={() => { setPreviewImage(null); setLightboxZoom(1); }}
          >
            <img
              src={previewImage}
              alt="Fullscreen Preview"
              style={{ transform: `scale(${lightboxZoom})` }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[82vh] rounded-2xl object-contain shadow-2xl transition-transform duration-200 cursor-zoom-in"
              onDoubleClick={() => setLightboxZoom(z => z === 1 ? 1.75 : 1)}
            />
          </div>

          {/* Footer Instructions */}
          <div className="text-center text-slate-400 text-[11px] font-medium">
            Click background or press Esc to close • Double-click image to zoom
          </div>
        </div>
      )}

      {/* Group Info Modal */}
      {showGroupInfoModal && isGroup && userProfile && (
        <GroupInfoModal
          chat={chat}
          currentUserProfile={userProfile}
          friends={friends}
          onClose={() => setShowGroupInfoModal(false)}
          onGroupLeft={onGroupLeft}
        />
      )}

      {/* Delete Message Confirmation Modal */}
      {confirmDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-100 dark:bg-rose-950/60 rounded-2xl text-rose-600 dark:text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">Delete Message?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This message will be permanently deleted for everyone in this chat.
                </p>
              </div>
            </div>

            {confirmDeleteModal.text && (
              <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-xl text-xs text-slate-700 dark:text-slate-300 italic truncate border border-slate-200/60 dark:border-slate-600/60">
                "{confirmDeleteModal.text}"
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteModal(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (!chat.id) return;
                  setIsDeleting(true);
                  try {
                    await deleteMessage(chat.id, confirmDeleteModal.id);
                  } catch (err) {
                    console.error('Error deleting message:', err);
                  } finally {
                    setIsDeleting(false);
                    setConfirmDeleteModal(null);
                  }
                }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 transition-all disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete for Everyone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


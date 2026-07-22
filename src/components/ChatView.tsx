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
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ChatRoom, ChatMessage, UserProfile } from '../types';
import { 
  subscribeToMessages, 
  sendMessage, 
  markChatAsRead, 
  setTypingIndicator, 
  toggleMessageReaction, 
  deleteMessage 
} from '../services/chatService';
import { GroupInfoModal } from './GroupInfoModal';

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
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null); // messageId
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<any>(null);

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

  // Send Text Message
  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !selectedImage) || !userProfile || !chat.id) return;

    const textToSend = inputText.trim();
    const imgToSend = selectedImage;

    setInputText('');
    setSelectedImage(null);
    setTypingIndicator(chat.id, userProfile.uid, false);

    try {
      if (imgToSend) {
        await sendMessage(chat.id, userProfile.uid, textToSend || 'Image Attachment', 'image', imgToSend, userProfile);
      } else {
        await sendMessage(chat.id, userProfile.uid, textToSend, 'text', undefined, userProfile);
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  // Handle Image Upload
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Image must be under 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setSelectedImage(reader.result);
        }
      };
      reader.readAsDataURL(file);
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
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
      
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
          <div 
            onClick={() => isGroup && setShowGroupInfoModal(true)}
            className={`flex items-center gap-3.5 min-w-0 ${isGroup ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
          >
          <div className="relative shrink-0">
            <img
              src={avatarUrl}
              alt={title}
              className="w-11 h-11 rounded-2xl object-cover bg-blue-50 ring-2 ring-blue-500/20"
            />
            {isGroup ? (
              <span className="absolute -bottom-1 -right-1 px-1 py-0.5 bg-blue-600 text-white text-[9px] font-bold rounded-md ring-2 ring-white dark:ring-slate-900 flex items-center gap-0.5">
                <Users2 className="w-2.5 h-2.5" />
                {chat.participants?.length || 0}
              </span>
            ) : (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 ring-2 ring-white dark:ring-slate-900 rounded-full" />
            )}
          </div>

          <div className="min-w-0">
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
            ) : (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Online</span>
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
            const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
            const senderProfile = isGroup ? chat.participantProfiles?.[msg.senderId] : null;

            const senderDisplayName = msg.senderName || senderProfile?.displayName || (isMe ? 'You' : 'Member');
            const senderAvatar = msg.senderPhoto || senderProfile?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.senderId}`;

            const readCount = (msg.readBy || []).filter(u => u !== msg.senderId).length;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group relative`}
              >
                <div className="flex items-end gap-2 max-w-[85%] sm:max-w-[70%]">
                  {!isMe && (
                    <img
                      src={senderAvatar}
                      alt={senderDisplayName}
                      className="w-8 h-8 rounded-xl object-cover bg-blue-50 shrink-0 mb-1"
                      title={senderDisplayName}
                    />
                  )}

                  {/* Message Bubble Container */}
                  <div
                    className={`relative p-3.5 rounded-2xl text-xs md:text-sm shadow-2xs leading-relaxed space-y-1.5 ${
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
                      <div className="overflow-hidden rounded-xl max-w-xs cursor-pointer" onClick={() => setPreviewImage(msg.mediaUrl || null)}>
                        <img src={msg.mediaUrl} alt="Attached Media" className="w-full h-auto object-cover hover:scale-105 transition-transform" />
                      </div>
                    )}

                    {/* Audio Voice Note */}
                    {msg.type === 'audio' && msg.mediaUrl && (
                      <div className="flex items-center gap-3 p-2 bg-black/10 dark:bg-white/10 rounded-xl min-w-[180px]">
                        <button
                          type="button"
                          onClick={() => togglePlayAudio(msg.id, msg.mediaUrl!)}
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

                  {/* Hover Actions: Reactions & Delete */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"
                      title="Add reaction"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>

                    {isMe && (
                      <button
                        type="button"
                        onClick={() => deleteMessage(chat.id, msg.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Delete message"
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

      {/* Selected Image Preview before sending */}
      {selectedImage && (
        <div className="p-3 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={selectedImage} alt="Selected attachment" className="w-12 h-12 rounded-xl object-cover" />
            <div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">Image attached</span>
              <span className="text-[10px] text-slate-400">Ready to send</span>
            </div>
          </div>
          <button
            onClick={() => setSelectedImage(null)}
            className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input Control Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <form onSubmit={handleSendText} className="flex items-center gap-2">
          
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
            className="p-2.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Attach image"
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
            placeholder={isGroup ? `Message ${title}...` : `Message ${title}...`}
            className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs md:text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!inputText.trim() && !selectedImage}
            className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-md shadow-blue-600/20 transition-all disabled:opacity-40 disabled:shadow-none"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Modal image lightbox */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-pointer"
        >
          <img src={previewImage} alt="Fullscreen Preview" className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" />
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
    </div>
  );
};


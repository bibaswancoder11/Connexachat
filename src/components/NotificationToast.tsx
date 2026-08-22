import React, { useEffect } from 'react';
import { MessageSquare, Users, UserCheck, X, ArrowRight, Bell, Sparkles } from 'lucide-react';

export interface ToastNotificationData {
  id: string;
  type: 'message' | 'request' | 'friend_accepted';
  title: string;
  body: string;
  avatar?: string;
  chatId?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface NotificationToastProps {
  toast: ToastNotificationData | null;
  onClose: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => {
      onClose();
    }, 6000);

    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const getBadgeIcon = () => {
    if (toast.type === 'message') {
      return <MessageSquare className="w-2.5 h-2.5 text-white" />;
    }
    if (toast.type === 'friend_accepted') {
      return <UserCheck className="w-2.5 h-2.5 text-white" />;
    }
    return <Users className="w-2.5 h-2.5 text-white" />;
  };

  const getBadgeBg = () => {
    if (toast.type === 'message') return 'bg-blue-600';
    if (toast.type === 'friend_accepted') return 'bg-emerald-600';
    return 'bg-indigo-600';
  };

  const getCategoryLabel = () => {
    if (toast.type === 'message') return 'New Message';
    if (toast.type === 'friend_accepted') return 'Friend Request Accepted 🎉';
    return 'Friend Request';
  };

  const getActionLabel = () => {
    if (toast.actionLabel) return toast.actionLabel;
    if (toast.type === 'message') return 'Open Chat';
    if (toast.type === 'friend_accepted') return 'Start Chatting';
    return 'View Requests';
  };

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full animate-in slide-in-from-top-3 fade-in duration-200">
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex items-start gap-3 relative group">
        
        {/* Avatar or Icon */}
        <div className="relative shrink-0">
          <img
            src={toast.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${toast.id}`}
            alt={toast.title}
            className="w-11 h-11 rounded-xl object-cover bg-blue-50 dark:bg-slate-800 ring-2 ring-blue-500/20"
          />
          <div className={`absolute -bottom-1 -right-1 p-1 ${getBadgeBg()} rounded-full ring-2 ring-white dark:ring-slate-900`}>
            {getBadgeIcon()}
          </div>
        </div>

        {/* Notification Content */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-1.5 mb-0.5">
            {toast.type === 'friend_accepted' ? (
              <Sparkles className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : (
              <Bell className="w-3 h-3 text-blue-500 shrink-0" />
            )}
            <span className={`text-[10px] font-bold uppercase tracking-wider ${
              toast.type === 'friend_accepted'
                ? 'text-emerald-600 dark:text-emerald-400'
                : toast.type === 'message'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-indigo-600 dark:text-indigo-400'
            }`}>
              {getCategoryLabel()}
            </span>
          </div>
          <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
            {toast.title}
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5 leading-snug">
            {toast.body}
          </p>

          {/* Direct Action Button */}
          {toast.onAction && (
            <button
              onClick={() => {
                toast.onAction?.();
                onClose();
              }}
              className={`mt-2 text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                toast.type === 'friend_accepted'
                  ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
                  : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'
              }`}
            >
              <span>{getActionLabel()}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

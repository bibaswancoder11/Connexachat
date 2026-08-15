import React, { useEffect } from 'react';
import { MessageSquare, Users, X, ArrowRight, Bell } from 'lucide-react';

export interface ToastNotificationData {
  id: string;
  type: 'message' | 'request';
  title: string;
  body: string;
  avatar?: string;
  chatId?: string;
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
    }, 5500);

    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full animate-in slide-in-from-top-3 fade-in duration-200">
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex items-start gap-3 relative group">
        
        {/* Avatar or Icon */}
        <div className="relative shrink-0">
          <img
            src={toast.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${toast.id}`}
            alt={toast.title}
            className="w-10 h-10 rounded-xl object-cover bg-blue-50 dark:bg-slate-800 ring-2 ring-blue-500/20"
          />
          <div className="absolute -bottom-1 -right-1 p-1 bg-blue-600 text-white rounded-full">
            {toast.type === 'message' ? (
              <MessageSquare className="w-2.5 h-2.5" />
            ) : (
              <Users className="w-2.5 h-2.5" />
            )}
          </div>
        </div>

        {/* Notification Content */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Bell className="w-3 h-3 text-blue-500 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {toast.type === 'message' ? 'New Message' : 'Friend Request'}
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
              className="mt-2 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
            >
              <span>{toast.type === 'message' ? 'Open Chat' : 'View Requests'}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

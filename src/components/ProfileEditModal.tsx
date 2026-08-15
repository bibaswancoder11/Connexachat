import React, { useState, useEffect } from 'react';
import { X, Save, User, FileText, CheckCircle2, Bell, Volume2, ShieldCheck, ExternalLink, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AvatarPicker } from './AvatarPicker';
import { testNotification, getNotificationPermission, requestNotificationPermission, isInIframe } from '../services/notificationService';

interface ProfileEditModalProps {
  onClose: () => void;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({ onClose }) => {
  const { userProfile, updateProfile } = useAuth();
  
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [photoURL, setPhotoURL] = useState(userProfile?.photoURL || '');
  const [bio, setBio] = useState(userProfile?.bio || '');
  const [notifState, setNotifState] = useState<string>('default');
  const [iframeNotice, setIframeNotice] = useState<boolean>(false);
  const [notifSuccess, setNotifSuccess] = useState<string | null>(null);
  
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setNotifState(getNotificationPermission());
    setIframeNotice(isInIframe());
  }, []);

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName || '');
      setPhotoURL(userProfile.photoURL || '');
      setBio(userProfile.bio !== undefined ? userProfile.bio : '');
    }
  }, [userProfile?.uid, userProfile?.displayName, userProfile?.photoURL, userProfile?.bio]);

  const handleEnableNotifications = async () => {
    setNotifSuccess(null);
    if (isInIframe()) {
      setIframeNotice(true);
      // Even in iframe, trigger the audio and in-app banner test so user gets instant confirmation!
      testNotification();
      setNotifSuccess('In-app notification banner & chime tested! To allow system desktop push alerts, open in a new tab.');
      return;
    }

    const state = await requestNotificationPermission();
    setNotifState(state);
    if (state === 'granted') {
      testNotification();
      setNotifSuccess('Push notifications enabled & chime tested!');
    } else if (state === 'denied') {
      setNotifSuccess('Notifications are blocked by your browser settings. Please enable them in your address bar lock icon.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        photoURL,
        bio: bio.trim()
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Edit Profile</h2>
            <p className="text-xs text-slate-500">Update your avatar, name, and bio</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-400 rounded-2xl flex items-center gap-2 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Profile updated successfully!</span>
            </div>
          )}

          {/* User ID / Handle Banner */}
          <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/40 rounded-2xl border border-blue-100 dark:border-blue-900 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider block">Your Connexa Handle & ID</span>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 font-mono">
                @{userProfile?.username}
                <span className="text-blue-600 dark:text-blue-400 ml-0.5">{userProfile?.userTag}</span>
              </div>
            </div>
            <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full bg-blue-200/60 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300">
              Unique ID
            </span>
          </div>

          {/* Avatar Picker */}
          <AvatarPicker
            currentPhotoURL={photoURL}
            onSelectPhoto={(url) => setPhotoURL(url)}
            usernameSeed={userProfile?.username || 'user'}
          />

          {/* Display Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Display Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              About / Bio
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share a snippet about yourself..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white resize-none"
              />
            </div>
          </div>

          {/* Real-time Push & Sound Notification Settings */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Real-Time Notifications</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Push alerts for messages & friend requests</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                notifState === 'granted'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
              }`}>
                {notifState === 'granted' ? 'Enabled' : notifState === 'denied' ? 'Blocked' : 'Action Needed'}
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              {notifState !== 'granted' ? (
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Enable Push Notifications</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => testNotification()}
                  className="w-full py-2 px-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5 text-blue-500" />
                  <span>Test Notification Banner & Sound</span>
                </button>
              )}

              {iframeNotice && (
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>In preview mode: Browser security prevents permission popups inside an iframe. Open in a new tab to enable desktop push alerts.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="w-full py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open App in New Tab</span>
                  </button>
                </div>
              )}

              {notifSuccess && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium text-center">
                  {notifSuccess}
                </p>
              )}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-xl text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { MessageSquare, LogOut, Settings, UserCheck, Search, Users, Sparkles, Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ProfileEditModal } from './ProfileEditModal';

interface NavigationHeaderProps {
  activeTab: 'chats' | 'search' | 'requests';
  onNavigateTab: (tab: 'chats' | 'search' | 'requests') => void;
  unreadRequestsCount: number;
}

export const NavigationHeader: React.FC<NavigationHeaderProps> = ({
  activeTab,
  onNavigateTab,
  unreadRequestsCount
}) => {
  const { userProfile, logout } = useAuth();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <>
      <header className="h-16 px-4 md:px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 z-20">
        
        {/* Left Branding */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600 rounded-xl text-white shadow-md shadow-blue-600/20">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">
              Connexa
            </h1>
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-widest">
              Sleek Messenger
            </span>
          </div>
        </div>

        {/* Center Quick Navigation Bar */}
        <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => onNavigateTab('chats')}
            className={`px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'chats'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chats</span>
          </button>

          <button
            onClick={() => onNavigateTab('search')}
            className={`px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'search'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Find Friends</span>
          </button>

          <button
            onClick={() => onNavigateTab('requests')}
            className={`px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 relative ${
              activeTab === 'requests'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Requests</span>
            {unreadRequestsCount > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500 text-white font-bold text-[10px] rounded-full">
                {unreadRequestsCount}
              </span>
            )}
          </button>
        </div>

        {/* Right User Profile Pill & Controls */}
        <div className="flex items-center gap-2">
          
          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Toggle Theme"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Profile Pill */}
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-2.5 p-1.5 pr-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 rounded-xl border border-slate-200 dark:border-slate-700/80 transition-all text-left"
          >
            <img
              src={userProfile?.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile?.username || 'user'}`}
              alt={userProfile?.displayName || 'Profile'}
              className="w-8 h-8 rounded-lg object-cover bg-blue-50 ring-2 ring-blue-500/20"
            />
            <div className="hidden sm:block">
              <span className="font-semibold text-xs text-slate-900 dark:text-white block leading-tight">
                {userProfile?.displayName}
              </span>
              <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-medium block">
                @{userProfile?.username}{userProfile?.userTag}
              </span>
            </div>
            <Settings className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
          </button>

          {/* Logout Button */}
          <button
            onClick={logout}
            className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
        </div>
      </header>

      {/* Edit Profile Modal */}
      {showProfileModal && (
        <ProfileEditModal onClose={() => setShowProfileModal(false)} />
      )}
    </>
  );
};

import React, { useState } from 'react';
import { UserProfile } from '../types';
import { createGroupChat } from '../services/chatService';
import { Users, X, Check, Search, Sparkles, Image as ImageIcon } from 'lucide-react';

interface CreateGroupModalProps {
  currentUserProfile: UserProfile;
  friends: UserProfile[];
  onClose: () => void;
  onGroupCreated: (chatId: string) => void;
}

const PRESET_GROUP_ICONS = [
  'https://api.dicebear.com/7.x/identicon/svg?seed=rocket',
  'https://api.dicebear.com/7.x/identicon/svg?seed=coffee',
  'https://api.dicebear.com/7.x/identicon/svg?seed=gaming',
  'https://api.dicebear.com/7.x/identicon/svg?seed=study',
  'https://api.dicebear.com/7.x/identicon/svg?seed=squad',
  'https://api.dicebear.com/7.x/identicon/svg?seed=party',
];

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  currentUserProfile,
  friends,
  onClose,
  onGroupCreated
}) => {
  const [groupName, setGroupName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_GROUP_ICONS[0]);
  const [selectedMemberUids, setSelectedMemberUids] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filteredFriends = friends.filter(
    f => f.displayName.toLowerCase().includes(filterQuery.toLowerCase()) ||
         f.username.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const toggleMemberSelection = (uid: string) => {
    if (selectedMemberUids.includes(uid)) {
      setSelectedMemberUids(selectedMemberUids.filter(id => id !== uid));
    } else {
      setSelectedMemberUids([...selectedMemberUids, uid]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    if (selectedMemberUids.length === 0) {
      setError('Please select at least 1 friend to join the group');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const chatId = await createGroupChat(
        groupName.trim(),
        selectedAvatar,
        currentUserProfile,
        selectedMemberUids
      );
      onGroupCreated(chatId);
      onClose();
    } catch (err) {
      console.error('Error creating group chat:', err);
      setError('Failed to create group. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                New Group Chat
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create a space for your friends and team
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleCreate} className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-xl text-xs font-medium">
              {error}
            </div>
          )}

          {/* Group Name & Icon */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Group Name
              </label>
              <input
                type="text"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Weekend Crew, Project Alpha..."
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white font-medium"
              />
            </div>

            {/* Avatar Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Group Icon
              </label>
              <div className="flex items-center gap-3 overflow-x-auto pb-2">
                {PRESET_GROUP_ICONS.map((iconUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedAvatar(iconUrl)}
                    className={`relative p-1 rounded-2xl border-2 transition-all shrink-0 ${
                      selectedAvatar === iconUrl
                        ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/20 bg-blue-50 dark:bg-slate-800'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <img src={iconUrl} alt="Icon" className="w-10 h-10 rounded-xl object-cover" />
                    {selectedAvatar === iconUrl && (
                      <span className="absolute -top-1 -right-1 bg-blue-600 text-white rounded-full p-0.5">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Select Members Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Add Friends ({selectedMemberUids.length} selected)
              </label>
              {friends.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedMemberUids.length === friends.length) {
                      setSelectedMemberUids([]);
                    } else {
                      setSelectedMemberUids(friends.map(f => f.uid));
                    }
                  }}
                  className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                >
                  {selectedMemberUids.length === friends.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {/* Filter Search */}
            {friends.length > 3 && (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter friends..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-white"
                />
              </div>
            )}

            {/* Friends List */}
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-2xl">
              {friends.length === 0 ? (
                <div className="p-6 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-500">You need to have added friends to invite them to a group chat.</p>
                </div>
              ) : filteredFriends.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No friends matching "{filterQuery}"
                </div>
              ) : (
                filteredFriends.map((friend) => {
                  const isSelected = selectedMemberUids.includes(friend.uid);
                  return (
                    <div
                      key={friend.uid}
                      onClick={() => toggleMemberSelection(friend.uid)}
                      className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={friend.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                          alt={friend.displayName}
                          className="w-9 h-9 rounded-xl object-cover bg-slate-100 dark:bg-slate-800"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {friend.displayName}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            @{friend.username}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !groupName.trim() || selectedMemberUids.length === 0}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
            >
              {loading ? 'Creating Group...' : 'Create Group Chat'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

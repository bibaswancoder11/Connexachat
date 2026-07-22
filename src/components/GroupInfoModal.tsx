import React, { useState } from 'react';
import { ChatRoom, UserProfile } from '../types';
import { addMembersToGroup, leaveGroup, updateGroupDetails } from '../services/chatService';
import { Users, X, Shield, UserPlus, LogOut, Edit3, Check, Search, Crown } from 'lucide-react';

interface GroupInfoModalProps {
  chat: ChatRoom;
  currentUserProfile: UserProfile;
  friends: UserProfile[];
  onClose: () => void;
  onGroupLeft?: () => void;
}

const PRESET_GROUP_ICONS = [
  'https://api.dicebear.com/7.x/identicon/svg?seed=rocket',
  'https://api.dicebear.com/7.x/identicon/svg?seed=coffee',
  'https://api.dicebear.com/7.x/identicon/svg?seed=gaming',
  'https://api.dicebear.com/7.x/identicon/svg?seed=study',
  'https://api.dicebear.com/7.x/identicon/svg?seed=squad',
  'https://api.dicebear.com/7.x/identicon/svg?seed=party',
];

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  chat,
  currentUserProfile,
  friends,
  onClose,
  onGroupLeft
}) => {
  const isAdmin = chat.adminUids?.includes(currentUserProfile.uid) || chat.createdBy === currentUserProfile.uid;

  const [activeTab, setActiveTab] = useState<'members' | 'add' | 'edit'>('members');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Editing group details state
  const [editName, setEditName] = useState(chat.groupName || '');
  const [editAvatar, setEditAvatar] = useState(chat.groupAvatar || '');

  // Add members state
  const [selectedFriendsToAdd, setSelectedFriendsToAdd] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Get current member profiles map or fallback list
  const memberProfilesMap = chat.participantProfiles || {};
  const currentMemberUids = chat.participants || [];

  const memberProfilesList = currentMemberUids.map(uid => memberProfilesMap[uid] || {
    uid,
    displayName: uid === currentUserProfile.uid ? currentUserProfile.displayName : 'Member',
    username: uid.substring(0, 8),
    userTag: '',
    email: '',
    photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
    createdAt: 0
  } as UserProfile);

  const filteredMembers = memberProfilesList.filter(
    m => m.displayName.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
         m.username.toLowerCase().includes(memberSearchQuery.toLowerCase())
  );

  // Friends not yet in group
  const friendsNotInGroup = friends.filter(f => !currentMemberUids.includes(f.uid));

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;

    setLoading(true);
    setError('');

    try {
      await updateGroupDetails(chat.id, currentUserProfile, editName.trim(), editAvatar);
      setActiveTab('members');
    } catch (err) {
      console.error('Failed to update group:', err);
      setError('Failed to update group details');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFriendsToAdd.length === 0) return;

    setLoading(true);
    setError('');

    try {
      const selectedProfiles = friends.filter(f => selectedFriendsToAdd.includes(f.uid));
      await addMembersToGroup(chat.id, currentUserProfile, selectedProfiles);
      setSelectedFriendsToAdd([]);
      setActiveTab('members');
    } catch (err) {
      console.error('Failed to add members:', err);
      setError('Failed to add members');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!window.confirm('Are you sure you want to leave this group chat?')) return;

    setLoading(true);
    try {
      await leaveGroup(chat.id, currentUserProfile);
      onClose();
      if (onGroupLeft) onGroupLeft();
    } catch (err) {
      console.error('Error leaving group:', err);
      setError('Failed to leave group');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Banner */}
        <div className="p-6 bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 text-white relative flex flex-col items-center text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <img
            src={chat.groupAvatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${chat.groupName}`}
            alt={chat.groupName}
            className="w-20 h-20 rounded-2xl object-cover ring-4 ring-white/20 shadow-lg bg-white/10 mb-3"
          />

          <h2 className="text-xl font-bold tracking-tight text-white">{chat.groupName}</h2>
          <p className="text-xs text-blue-200 mt-1 font-medium">
            {currentMemberUids.length} members • {isAdmin ? 'Group Admin' : 'Group Member'}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-1.5 gap-1">
          <button
            onClick={() => setActiveTab('members')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'members'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Members ({currentMemberUids.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'add'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Members</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => setActiveTab('edit')}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'edit'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Group</span>
            </button>
          )}
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-600 border border-red-200 dark:border-red-900 rounded-xl text-xs">
              {error}
            </div>
          )}

          {/* Members List Tab */}
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="Search group members..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-hidden text-slate-900 dark:text-white"
                />
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl max-h-64 overflow-y-auto">
                {filteredMembers.map((member) => {
                  const isMemberAdmin = chat.adminUids?.includes(member.uid) || chat.createdBy === member.uid;
                  const isSelf = member.uid === currentUserProfile.uid;

                  return (
                    <div key={member.uid} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={member.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${member.username}`}
                          alt={member.displayName}
                          className="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-slate-800"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {member.displayName} {isSelf && '(You)'}
                            </span>
                            {isMemberAdmin && (
                              <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 font-semibold text-[10px] rounded-md flex items-center gap-0.5 shrink-0">
                                <Crown className="w-3 h-3 text-amber-500" />
                                Admin
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 block truncate">
                            @{member.username}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Leave Group Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleLeaveGroup}
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-900/80 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Leave Group Chat</span>
                </button>
              </div>
            </div>
          )}

          {/* Add Members Tab */}
          {activeTab === 'add' && (
            <form onSubmit={handleAddMembers} className="space-y-4">
              <p className="text-xs text-slate-500">
                Select friends to invite into <strong className="text-slate-800 dark:text-slate-200">{chat.groupName}</strong>:
              </p>

              {friendsNotInGroup.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-1">
                  <p className="text-xs text-slate-500 font-medium">All your friends are already in this group!</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl max-h-56 overflow-y-auto">
                  {friendsNotInGroup.map((friend) => {
                    const isSelected = selectedFriendsToAdd.includes(friend.uid);
                    return (
                      <div
                        key={friend.uid}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedFriendsToAdd(selectedFriendsToAdd.filter(id => id !== friend.uid));
                          } else {
                            setSelectedFriendsToAdd([...selectedFriendsToAdd, friend.uid]);
                          }
                        }}
                        className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
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

                        <div className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all ${
                          isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {friendsNotInGroup.length > 0 && (
                <button
                  type="submit"
                  disabled={loading || selectedFriendsToAdd.length === 0}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
                >
                  {loading ? 'Adding Members...' : `Add Selected (${selectedFriendsToAdd.length})`}
                </button>
              )}
            </form>
          )}

          {/* Edit Group Tab (Admin only) */}
          {activeTab === 'edit' && isAdmin && (
            <form onSubmit={handleUpdateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
                  Group Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
                  Select Group Avatar
                </label>
                <div className="flex items-center gap-3 overflow-x-auto pb-2">
                  {PRESET_GROUP_ICONS.map((iconUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setEditAvatar(iconUrl)}
                      className={`relative p-1 rounded-2xl border-2 transition-all shrink-0 ${
                        editAvatar === iconUrl
                          ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/20 bg-blue-50 dark:bg-slate-800'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <img src={iconUrl} alt="Icon" className="w-10 h-10 rounded-xl object-cover" />
                      {editAvatar === iconUrl && (
                        <span className="absolute -top-1 -right-1 bg-blue-600 text-white rounded-full p-0.5">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !editName.trim()}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Group Info'}
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};

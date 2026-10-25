import React, { createContext, useContext, useState } from 'react';
import { AvatarPreviewData, AvatarPreviewModal } from '../components/AvatarPreviewModal';
import { FriendRequest, UserProfile } from '../types';

interface AvatarPreviewContextType {
  openAvatarPreview: (data: AvatarPreviewData) => void;
  closeAvatarPreview: () => void;
  previewData: AvatarPreviewData | null;
}

const AvatarPreviewContext = createContext<AvatarPreviewContextType | undefined>(undefined);

export const AvatarPreviewProvider: React.FC<{
  children: React.ReactNode;
  friends?: UserProfile[];
  incomingRequests?: FriendRequest[];
  outgoingRequests?: FriendRequest[];
  onOpenDirectChat?: (uid: string) => void;
  onSendFriendRequest?: (targetUser: UserProfile) => Promise<void>;
  onNavigateToRequests?: () => void;
}> = ({
  children,
  friends = [],
  incomingRequests = [],
  outgoingRequests = [],
  onOpenDirectChat,
  onSendFriendRequest,
  onNavigateToRequests
}) => {
  const [previewData, setPreviewData] = useState<AvatarPreviewData | null>(null);

  const openAvatarPreview = (data: AvatarPreviewData) => {
    setPreviewData(data);
  };

  const closeAvatarPreview = () => {
    setPreviewData(null);
  };

  return (
    <AvatarPreviewContext.Provider value={{ openAvatarPreview, closeAvatarPreview, previewData }}>
      {children}
      <AvatarPreviewModal
        data={previewData}
        friends={friends}
        incomingRequests={incomingRequests}
        outgoingRequests={outgoingRequests}
        onClose={closeAvatarPreview}
        onOpenDirectChat={onOpenDirectChat}
        onSendFriendRequest={onSendFriendRequest}
        onNavigateToRequests={onNavigateToRequests}
      />
    </AvatarPreviewContext.Provider>
  );
};

export const useAvatarPreview = (): AvatarPreviewContextType => {
  const context = useContext(AvatarPreviewContext);
  if (!context) {
    throw new Error('useAvatarPreview must be used within an AvatarPreviewProvider');
  }
  return context;
};

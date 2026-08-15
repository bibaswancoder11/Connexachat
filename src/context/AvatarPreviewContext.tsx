import React, { createContext, useContext, useState } from 'react';
import { AvatarPreviewData, AvatarPreviewModal } from '../components/AvatarPreviewModal';

interface AvatarPreviewContextType {
  openAvatarPreview: (data: AvatarPreviewData) => void;
  closeAvatarPreview: () => void;
  previewData: AvatarPreviewData | null;
}

const AvatarPreviewContext = createContext<AvatarPreviewContextType | undefined>(undefined);

export const AvatarPreviewProvider: React.FC<{
  children: React.ReactNode;
  onOpenDirectChat?: (uid: string) => void;
}> = ({ children, onOpenDirectChat }) => {
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
        onClose={closeAvatarPreview}
        onOpenDirectChat={onOpenDirectChat}
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

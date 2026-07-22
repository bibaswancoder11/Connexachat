import React, { useRef, useState } from 'react';
import { Camera, RefreshCw, Upload, Check } from 'lucide-react';

interface AvatarPickerProps {
  currentPhotoURL: string;
  onSelectPhoto: (url: string) => void;
  usernameSeed?: string;
}

const PRESET_STYLES = [
  { name: 'Bottts', style: 'bottts' },
  { name: 'Adventurer', style: 'adventurer' },
  { name: 'Avataaars', style: 'avataaars' },
  { name: 'Lorelei', style: 'lorelei' },
  { name: 'Fun Emoji', style: 'fun-emoji' },
  { name: 'Micah', style: 'micah' },
];

export const AvatarPicker: React.FC<AvatarPickerProps> = ({
  currentPhotoURL,
  onSelectPhoto,
  usernameSeed = 'user'
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'presets' | 'upload'>('presets');
  const [seed, setSeed] = useState(usernameSeed);

  const generatePresetUrl = (style: string, customSeed: string) => {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(customSeed)}`;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
        alert('File size must be under 3MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          onSelectPhoto(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const randomizePresets = () => {
    const newSeed = Math.random().toString(36).substring(2, 9);
    setSeed(newSeed);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Profile Photo
        </label>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`px-3 py-1 rounded-md transition-all ${
              activeTab === 'presets'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Avatar Presets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3 py-1 rounded-md transition-all ${
              activeTab === 'upload'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Upload Photo
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Current Selected Avatar Preview */}
        <div className="relative group shrink-0">
          <img
            src={currentPhotoURL || generatePresetUrl('bottts', seed)}
            alt="Profile Preview"
            className="w-20 h-20 rounded-2xl object-cover ring-4 ring-blue-500/20 shadow-md bg-blue-50 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 p-1.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"
            title="Upload custom photo"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        </div>

        {activeTab === 'presets' && (
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">Choose a generated avatar</span>
              <button
                type="button"
                onClick={randomizePresets}
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                <RefreshCw className="w-3 h-3" />
                Randomize
              </button>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {PRESET_STYLES.map((preset) => {
                const url = generatePresetUrl(preset.style, seed);
                const isSelected = currentPhotoURL === url;
                return (
                  <button
                    key={preset.style}
                    type="button"
                    onClick={() => onSelectPhoto(url)}
                    className={`relative p-1 rounded-xl border-2 transition-all hover:scale-105 bg-slate-50 dark:bg-slate-800/80 ${
                      isSelected
                        ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/20'
                        : 'border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <img src={url} alt={preset.name} className="w-10 h-10 rounded-lg" />
                    {isSelected && (
                      <span className="absolute -top-1 -right-1 bg-blue-600 text-white rounded-full p-0.5 shadow-sm">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 px-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center gap-1 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all bg-slate-50/50 dark:bg-slate-800/30"
            >
              <Upload className="w-5 h-5" />
              <span className="text-xs font-medium">Click to select an image from your device</span>
              <span className="text-[10px] text-slate-400">PNG, JPG, WebP up to 3MB</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

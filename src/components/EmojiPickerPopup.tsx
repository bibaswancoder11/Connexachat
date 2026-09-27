import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Sparkles, Send } from 'lucide-react';
import { EMOJI_CATEGORIES, QUICK_EMOJIS, EmojiCategory } from '../utils/emojiUtils';

interface EmojiPickerPopupProps {
  onSelectEmoji: (emoji: string) => void;
  onSendEmoji?: (emoji: string) => void;
  onClose: () => void;
}

export const EmojiPickerPopup: React.FC<EmojiPickerPopupProps> = ({
  onSelectEmoji,
  onSendEmoji,
  onClose
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string>('smileys');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Filter emojis across all categories based on search
  const filteredEmojis = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return null;

    const results: { emoji: string; name: string }[] = [];
    EMOJI_CATEGORIES.forEach(cat => {
      cat.emojis.forEach(item => {
        if (
          item.name.toLowerCase().includes(q) ||
          item.keywords?.some(k => k.toLowerCase().includes(q))
        ) {
          results.push(item);
        }
      });
    });
    return results;
  }, [searchQuery]);

  const activeCategory = useMemo(() => {
    return EMOJI_CATEGORIES.find(c => c.id === activeCategoryId) || EMOJI_CATEGORIES[0];
  }, [activeCategoryId]);

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full mb-2.5 left-2 right-2 sm:left-4 sm:right-auto sm:w-96 max-w-[calc(100vw-1rem)] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/90 dark:border-slate-800 flex flex-col h-[360px] max-h-[55vh] z-40 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      {/* Header with Search and Close */}
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emojis..."
            className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close emoji picker (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Emojis Bar */}
      <div className="px-3 py-1.5 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-1 overflow-x-auto scrollbar-none">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          Quick:
        </span>
        <div className="flex items-center gap-1">
          {QUICK_EMOJIS.map((emoji, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectEmoji(emoji)}
              onDoubleClick={() => onSendEmoji?.(emoji)}
              className="w-7 h-7 text-base rounded-lg hover:bg-white dark:hover:bg-slate-700 hover:scale-125 transition-all flex items-center justify-center cursor-pointer select-none"
              title={`${emoji} (Double-click to send)`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Main Emoji Grid View */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {filteredEmojis !== null ? (
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Search Results ({filteredEmojis.length})
            </div>
            {filteredEmojis.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No emojis found matching "{searchQuery}"
              </div>
            ) : (
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-1.5">
                {filteredEmojis.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectEmoji(item.emoji)}
                    onDoubleClick={() => onSendEmoji?.(item.emoji)}
                    className="w-9 h-9 text-xl rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 hover:scale-120 transition-all flex items-center justify-center cursor-pointer select-none"
                    title={`${item.name} (Double-click to send)`}
                  >
                    {item.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5">
              <span>{activeCategory.icon}</span>
              <span>{activeCategory.name}</span>
            </div>
            <div className="grid grid-cols-7 sm:grid-cols-8 gap-1.5">
              {activeCategory.emojis.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectEmoji(item.emoji)}
                  onDoubleClick={() => onSendEmoji?.(item.emoji)}
                  className="w-9 h-9 text-xl rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 hover:scale-120 transition-all flex items-center justify-center cursor-pointer select-none"
                  title={`${item.name} (Double-click to send)`}
                >
                  {item.emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Category Selector Bar */}
      <div className="p-1.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-around gap-1 shrink-0">
        {EMOJI_CATEGORIES.map(category => {
          const isActive = activeCategoryId === category.id && !searchQuery;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                setActiveCategoryId(category.id);
                setSearchQuery('');
              }}
              className={`p-1.5 text-base rounded-xl transition-all flex items-center justify-center cursor-pointer ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-950/80 scale-110 shadow-xs ring-1 ring-blue-500/30'
                  : 'hover:bg-slate-200/60 dark:hover:bg-slate-800 opacity-70 hover:opacity-100'
              }`}
              title={category.name}
            >
              <span>{category.icon}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

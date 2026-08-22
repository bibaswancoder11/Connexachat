import React from 'react';

interface ConnexaLogoProps {
  className?: string;
  size?: number | string;
  variant?: 'full' | 'icon' | 'badge';
}

export const ConnexaLogo: React.FC<ConnexaLogoProps> = ({
  className = '',
  size = 36,
  variant = 'icon'
}) => {
  return (
    <div
      className={`inline-flex items-center justify-center select-none shrink-0 ${className}`}
      style={{ width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size }}
    >
      <svg
        viewBox="0 0 512 512"
        className="w-full h-full drop-shadow-sm transition-transform duration-200"
      >
        <defs>
          <linearGradient id="connexaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="40%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
        </defs>

        {/* Squircle Background */}
        <rect
          x="16"
          y="16"
          width="480"
          height="480"
          rx="140"
          ry="140"
          fill="url(#connexaGrad)"
        />

        {/* Speech Bubble Icon matching uploaded logo */}
        <path
          d="M176 156 
             H336 
             C358.09 156 376 173.91 376 196 
             V300 
             C376 322.09 358.09 340 336 340 
             H212 
             L162 376 
             C156.4 380 148 376 148 369 
             V196 
             C148 173.91 165.91 156 188 156 Z"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

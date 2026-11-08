import React, { useState } from 'react';
import delphiCameraImg from '../assets/images/delphi_magic_camera_1793958109081.jpg';

export type DelphiMood = 'happy' | 'curious' | 'excited' | 'oops' | 'proud';

interface DelphiMascotProps {
  mood: DelphiMood;
  message: string;
  size?: 'sm' | 'md' | 'lg';
  reduceMotion?: boolean;
}

export const DelphiMascot: React.FC<DelphiMascotProps> = ({
  mood,
  message,
  size = 'md',
  reduceMotion = false,
}) => {
  const [imgError, setImgError] = useState(false);

  const moodBadgeMap: Record<DelphiMood, { emoji: string; ringClass: string; label: string }> = {
    happy: {
      emoji: '🐬',
      ringClass: 'ring-sky-400/70 bg-sky-500/20',
      label: 'دلفی خوشحال',
    },
    curious: {
      emoji: '🔍',
      ringClass: 'ring-teal-300/80 bg-teal-500/20',
      label: 'دلفی کنجکاو',
    },
    excited: {
      emoji: '✨',
      ringClass: 'ring-amber-300/90 bg-amber-400/25',
      label: 'دلفی هیجان‌زده',
    },
    oops: {
      emoji: '🙊',
      ringClass: 'ring-orange-400/80 bg-orange-500/25',
      label: 'دلفی متعجب',
    },
    proud: {
      emoji: '🏆',
      ringClass: 'ring-yellow-300/90 bg-yellow-400/25',
      label: 'دلفی افتخارآمیز',
    },
  };

  const currentMood = moodBadgeMap[mood];

  const avatarDimensions =
    size === 'lg'
      ? 'w-20 h-20 sm:w-24 sm:h-24'
      : size === 'sm'
        ? 'w-12 h-12'
        : 'w-14 h-14 sm:w-16 sm:h-16';

  return (
    <div
      className="flex items-center gap-3 w-full"
      aria-label={`پیام دلفی: ${message}`}
    >
      {/* Delphi Avatar with Mood Indicator */}
      <div className="relative shrink-0">
        <div
          className={`${avatarDimensions} rounded-2xl overflow-hidden ring-2 ${currentMood.ringClass} shadow-lg shadow-sky-950/60 flex items-center justify-center relative ${
            !reduceMotion && mood === 'excited' ? 'animate-bounce' : ''
          }`}
        >
          {!imgError ? (
            <img
              src={delphiCameraImg}
              alt="دلفی با دوربین جادویی"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <svg
              viewBox="0 0 64 64"
              className="w-10 h-10 text-sky-300"
              aria-hidden="true"
            >
              <circle cx="32" cy="32" r="28" fill="#0284c7" />
              <circle cx="24" cy="26" r="4" fill="#ffffff" />
              <circle cx="40" cy="26" r="4" fill="#ffffff" />
              <path
                d="M22 38 Q32 46 42 38"
                stroke="#ffffff"
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
        <span
          className="absolute -bottom-1 -left-1 w-6 h-6 rounded-full bg-[#091e3a] border border-sky-300/40 flex items-center justify-center text-xs shadow"
          title={currentMood.label}
          aria-hidden="true"
        >
          {currentMood.emoji}
        </span>
      </div>

      {/* Speech Bubble matching Delfina's rounded cream/marine speech bubble style */}
      <div className="relative flex-1 bg-[#f8fafc] text-[#0b2240] rounded-2xl rounded-tr-sm px-3.5 py-2.5 shadow-md border border-sky-200">
        <p className="text-xs sm:text-sm font-bold leading-relaxed">
          {message}
        </p>
      </div>
    </div>
  );
};

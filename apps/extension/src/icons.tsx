/** 静态可信内联图标（stroke 跟随 currentColor），每个图标渲染为 <span class="kx-svg"><svg/></span>。 */
import { LOGO_DATA_URI } from './logo-data.js';

interface IconProps {
  /** 外层 span 的类名；行内图标默认 kx-svg，草稿行图标传 kx-row-icon 等。 */
  className?: string;
  size?: number;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function RefreshIcon({ className = 'kx-svg', size = 15 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" />
        <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
      </svg>
    </span>
  );
}

export function CloseIcon({ className = 'kx-svg', size = 15 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </span>
  );
}

export function TrashIcon({ className = 'kx-svg', size = 15 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      </svg>
    </span>
  );
}

export function FileIcon({ className = 'kx-svg', size = 18 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="15" y2="17" />
      </svg>
    </span>
  );
}

export function AlertIcon({ className = 'kx-svg', size = 18 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12" y2="16.01" />
      </svg>
    </span>
  );
}

export function GearIcon({ className = 'kx-svg', size = 14 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
  );
}

export function HelpIcon({ className = 'kx-svg', size = 17 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12" y2="17.01" />
      </svg>
    </span>
  );
}

export function SearchIcon({ className = 'kx-svg', size = 19 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
    </span>
  );
}

export function SlidersIcon({ className = 'kx-svg', size = 19 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    </span>
  );
}

export function ChevronLeftIcon({ className = 'kx-svg', size = 16 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </span>
  );
}

export function ChevronRightIcon({ className = 'kx-svg', size = 16 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </span>
  );
}

export function CheckIcon({ className = 'kx-svg', size = 15 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

export function ImageIcon({ className = 'kx-svg', size = 18 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    </span>
  );
}

export function EyeIcon({ className = 'kx-svg', size = 15 }: IconProps) {
  return (
    <span className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
  );
}

/** 品牌头像小 logo（圆角方块 <img>），用在草稿箱与设置的标题旁。 */
export function LogoIcon({ className = 'kx-logo', size = 20 }: IconProps) {
  return <img className={className} src={LOGO_DATA_URI} width={size} height={size} alt="" />;
}

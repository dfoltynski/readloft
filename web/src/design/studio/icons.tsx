import type { ReactNode } from 'react';

function Svg({ size = 16, children, fill = 'none', sw = 2 }: { size?: number; children: ReactNode; fill?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const SIcon = {
  Prev: () => <Svg><path d="M15 6l-6 6 6 6" /></Svg>,
  Next: () => <Svg><path d="M9 6l6 6-6 6" /></Svg>,
  Search: () => <Svg size={14}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>,
  Upload: () => <Svg size={14} sw={2.2}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Svg>,
  Sync: () => <Svg size={14} sw={2.2}><path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" /></Svg>,
  Menu: () => <Svg size={18}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>,
  Gear: () => <Svg size={16}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></Svg>,
  Contents: () => <Svg><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></Svg>,
  Sliders: () => <Svg><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Svg>,
  Speaker: () => <Svg><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 010 6" /></Svg>,
  Pause: () => <Svg fill="currentColor" sw={0}><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></Svg>,
  Play: () => <Svg size={14} fill="currentColor" sw={0}><path d="M7 4l13 8-13 8z" /></Svg>,
  Bookmark: ({ filled }: { filled?: boolean }) => <Svg fill={filled ? 'currentColor' : 'none'}><path d="M7 4h10v16l-5-4-5 4z" /></Svg>,
  Fullscreen: ({ exit }: { exit?: boolean }) => (
    <Svg>{exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</Svg>
  ),
  Moon: () => <Svg><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></Svg>,
  Sun: () => <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  Back: () => <Svg><path d="M15 5l-7 7 7 7" /></Svg>,
  Grid: () => <Svg size={15}><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></Svg>,
  List: () => <Svg size={15}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>,
  Close: () => <Svg size={13}><path d="M6 6l12 12M18 6L6 18" /></Svg>,
};

/** Logo tile from the mock: dark rounded square with the orange bookmark mark. */
export function LogoTile() {
  return (
    <span className="st-logo" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 512 512">
        <path d="M256 92 L392 182 V416 L256 344 L120 416 V182 Z" fill="none" stroke="#f0a050" strokeWidth="44" strokeLinejoin="round" />
        <g stroke="#f6e3cc" strokeWidth="34" strokeLinecap="round"><path d="M186 226 H326" /><path d="M186 296 H290" /></g>
      </svg>
    </span>
  );
}

import type { ReactNode } from 'react';

function Svg({ children, fill = 'none' }: { children: ReactNode; fill?: string }) {
  return (
    <svg
      width={18} height={18} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconNightLight = ({ active }: { active?: boolean }) => (
  <Svg fill={active ? 'currentColor' : 'none'}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>
);
export const IconBookmark = ({ filled }: { filled?: boolean }) => (
  <Svg fill={filled ? 'currentColor' : 'none'}><path d="M6 3h12v18l-6-4-6 4z" /></Svg>
);
export const IconFullscreen = ({ exit }: { exit?: boolean }) => (
  <Svg>
    {exit
      ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </Svg>
);
export const IconHelp = () => (
  <Svg><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></Svg>
);
export const IconPencil = () => (
  <Svg><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></Svg>
);
export const IconTrash = () => (
  <Svg><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>
);

// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import StatusBar, { type Hint } from './StatusBar';
import TopBar, { type TopBarSearch } from './TopBar';

interface Props {
  active: 'library' | 'notes' | 'none';
  search?: TopBarSearch;
  onUpload?: () => void;
  onChanged?: () => void;
  onMenu?: () => void;
  refreshKey?: unknown;
  sidebar?: ReactNode;
  inspector?: ReactNode;
  statusLeft: ReactNode;
  hints: Hint[];
  children: ReactNode;
  /** Extra nodes rendered outside the grid (menus, dialogs, overlays). */
  overlays?: ReactNode;
}

/** Studio page chrome: top bar, optional sidebar + inspector, status bar. */
export default function StudioFrame({ sidebar, inspector, statusLeft, hints, children, overlays, ...top }: Props) {
  const cls = `st-body${sidebar ? ' has-side' : ''}${inspector ? ' has-insp' : ''}`;
  return (
    <div className="st-app">
      <TopBar {...top} />
      <div className={cls}>
        {sidebar}
        {children}
        {inspector}
      </div>
      <StatusBar left={statusLeft} hints={hints} />
      {overlays}
    </div>
  );
}

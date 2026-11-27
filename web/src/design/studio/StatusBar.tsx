// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export type Hint = [key: string, label: string];

export default function StatusBar({ left, hints }: { left: ReactNode; hints: Hint[] }) {
  return (
    <footer className="st-status">
      <span className="st-status-left">{left}</span>
      <span className="st-status-hints">
        {hints.map(([k, label], i) => (
          <span key={k + label}>{i > 0 && ' · '}<b>{k}</b> {label}</span>
        ))}
      </span>
    </footer>
  );
}

export const LIBRARY_HINTS: Hint[] = [['/', 'search'], ['U', 'upload'], ['?', 'shortcuts']];
export const READER_HINTS: Hint[] = [
  ['← →', 'turn'], ['D', 'pages'], ['T', 'contents'], ['N', 'note'], ['A', 'notes'], ['R', 'read aloud'], ['?', 'shortcuts'],
];

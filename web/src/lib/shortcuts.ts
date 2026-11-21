/** Single source of truth for keyboard shortcuts (help overlay, README). */
export interface ShortcutGroup {
  title: string;
  items: [keys: string, description: string][];
}

export const LIBRARY_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Library',
    items: [
      ['/', 'Focus search'],
      ['U', 'Upload books'],
      ['Ctrl/Cmd + A', 'Select all visible books'],
      ['Esc', 'Clear selection / leave search'],
      ['?', 'Keyboard shortcuts'],
    ],
  },
];

export const READER_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Reading',
    items: [
      ['← / →', 'Previous / next page'],
      ['Space / Shift+Space', 'Next / previous page'],
      ['PageUp / PageDown', 'Previous / next page'],
      ['F', 'Fullscreen'],
    ],
  },
  {
    title: 'Navigation',
    items: [
      ['T', 'Table of contents'],
      ['B', 'Toggle bookmark'],
      ['Ctrl/Cmd + F', 'Search in book'],
    ],
  },
  {
    title: 'Notes',
    items: [
      ['N', 'Add note to selection'],
      ['A', 'Notes panel'],
      ['Esc', 'Close note cards'],
    ],
  },
  {
    title: 'Read aloud',
    items: [
      ['R', 'Start / pause / resume'],
      ['[ / ]', 'Previous / next sentence'],
    ],
  },
  {
    title: 'General',
    items: [
      ['?', 'This help'],
      ['Esc', 'Close panels / stop reading aloud'],
    ],
  },
];

/** Opens the app-wide shortcuts overlay (handled by ShortcutsHost). */
export const SHORTCUTS_EVENT = 'readloft:shortcuts';
export const openShortcuts = () => window.dispatchEvent(new Event(SHORTCUTS_EVENT));

import { currentAppTheme } from './hooks';

export type ReaderTheme = 'light' | 'paper' | 'sepia' | 'dark' | 'black' | 'app';
export type ConcreteTheme = Exclude<ReaderTheme, 'app'>;
export type ReaderFont = 'default' | 'serif' | 'sans';

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  /** Percent, 80..200. */
  fontSize: number;
  /** Unitless multiplier, 1.2..2.0. */
  lineHeight: number;
  /** Max text column width in px. */
  maxWidth: number;
  /** Page gap/margin as percent of the page. */
  margin: number;
  justify: boolean;
  hyphenate: boolean;
  flow: 'paginated' | 'scrolled';
  columns: 'auto' | '1';
  /** Keep the screen awake while reading (Screen Wake Lock API). */
  keepAwake: boolean;
  /** Animate page turns in paginated mode. */
  animate: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'app',
  font: 'default',
  fontSize: 100,
  lineHeight: 1.5,
  maxWidth: 720,
  margin: 6,
  justify: true,
  hyphenate: true,
  flow: 'paginated',
  columns: 'auto',
  keepAwake: false,
  animate: true,
};

const STORAGE_KEY = 'readloft.reader';

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: ReaderSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface Palette {
  bg: string;
  fg: string;
  link: string;
  dark: boolean;
}

const PALETTES: Record<ConcreteTheme, Palette> = {
  light: { bg: '#ffffff', fg: '#1d1d1f', link: '#0b5fd6', dark: false },
  paper: { bg: '#f8f3e8', fg: '#4a3b30', link: '#8a4b0f', dark: false },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#8a4b0f', dark: false },
  dark: { bg: '#1c1c1e', fg: '#e3e3e6', link: '#8ab4f8', dark: true },
  black: { bg: '#000000', fg: '#c8c8cc', link: '#8ab4f8', dark: true },
};

/** Resolves "app" to the current app light/dark theme. */
export function resolveTheme(theme: ReaderTheme): ConcreteTheme {
  return theme === 'app' ? currentAppTheme() : theme;
}

export const paletteFor = (theme: ReaderTheme): Palette => PALETTES[resolveTheme(theme)];

const FONT_STACKS: Record<Exclude<ReaderFont, 'default'>, string> = {
  serif: `Charter, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif`,
  sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
};

/** CSS injected into every reflowable book section (modelled on foliate-js reader.js getCSS). */
export function buildBookCss(s: ReaderSettings): string {
  const p = paletteFor(s.theme);
  const font =
    s.font === 'default'
      ? ''
      : `html, body, p, li, blockquote, dd, div, span { font-family: ${FONT_STACKS[s.font]} !important; }`;
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${p.dark ? 'dark' : 'light'};
      color: ${p.fg};
      background: ${p.bg};
      font-size: ${s.fontSize}%;
    }
    body { background: transparent; color: inherit; }
    a:link { color: ${p.link}; }
    ${font}
    p, li, blockquote, dd {
      line-height: ${s.lineHeight};
      text-align: ${s.justify ? 'justify' : 'start'};
      -webkit-hyphens: ${s.hyphenate ? 'auto' : 'manual'};
      hyphens: ${s.hyphenate ? 'auto' : 'manual'};
      -webkit-hyphenate-limit-before: 3;
      -webkit-hyphenate-limit-after: 2;
      -webkit-hyphenate-limit-lines: 2;
      hanging-punctuation: allow-end last;
      widows: 2;
    }
    /* keep explicit alignment attributes working */
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] { display: none; }
  `;
}

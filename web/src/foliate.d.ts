// Minimal typings for the parts of foliate-js we use (vendored in public/foliate-js).

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}

export interface FoliateRelocateDetail {
  fraction: number;
  cfi?: string;
  tocItem?: FoliateTocItem;
  pageItem?: { label: string };
  location?: { current: number; total: number };
  /** Estimated minutes left in the section / book (reflowable books only). */
  time?: { section: number; total: number };
}

export interface FoliateSearchExcerpt { pre: string; match: string; post: string }
export interface FoliateSearchSection {
  label: string;
  subitems: { cfi: string; excerpt: FoliateSearchExcerpt }[];
}
export type FoliateSearchResult = FoliateSearchSection | { progress: number } | 'done';

export interface FoliateSearchOptions {
  query: string;
  matchCase?: boolean;
  matchDiacritics?: boolean;
  matchWholeWords?: boolean;
}

export interface FoliateRenderer extends HTMLElement {
  setStyles?(css: string): void;
  next(): Promise<void>;
  prev(): Promise<void>;
}

export interface FoliateBook {
  dir?: string;
  toc?: FoliateTocItem[];
  metadata?: { title?: unknown; author?: unknown };
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  isFixedLayout?: boolean;
  open(file: File): Promise<void>;
  close?(): void;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  getSectionFractions(): number[];
  search(opts: FoliateSearchOptions): AsyncGenerator<FoliateSearchResult>;
  clearSearch(): void;
}

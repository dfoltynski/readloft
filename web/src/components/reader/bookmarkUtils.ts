import type { Bookmark } from '@shared/types';

/** Subset of foliate's epubcfi.js we use. */
export interface CfiModule {
  collapse(cfi: string, toEnd?: boolean): string;
  compare(a: string, b: string): number;
}

/** Start of the page, as a collapsed CFI (what we store for bookmarks). */
export function pageStart(cfi: string, cfiMod: CfiModule | null): string {
  try {
    return cfiMod ? cfiMod.collapse(cfi) : cfi;
  } catch {
    return cfi;
  }
}

/** The bookmark on the current page, if any: its location lies within [page start, page end). */
export function findBookmarkOnPage(
  bookmarks: Bookmark[], pageCfi: string | undefined, cfiMod: CfiModule | null,
): Bookmark | undefined {
  if (!pageCfi) return undefined;
  const start = pageStart(pageCfi, cfiMod);
  return bookmarks.find((b) => {
    if (b.location === start || b.location === pageCfi) return true;
    if (!cfiMod) return false;
    try {
      const end = cfiMod.collapse(pageCfi, true);
      return cfiMod.compare(start, b.location) <= 0 && cfiMod.compare(b.location, end) < 0;
    } catch {
      return false;
    }
  });
}

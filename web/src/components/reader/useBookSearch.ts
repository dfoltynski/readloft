import { useCallback, useRef, useState } from 'react';
import type { FoliateSearchExcerpt, FoliateSearchSection, FoliateView } from '../../foliate';

export interface SearchSection {
  label: string;
  subitems: { cfi: string; excerpt: FoliateSearchExcerpt }[];
}

export interface BookSearch {
  query: string;
  setQuery: (q: string) => void;
  sections: SearchSection[];
  count: number;
  /** 0..1 while searching. */
  progress: number;
  status: 'idle' | 'searching' | 'done';
  run: (query: string) => void;
  clear: () => void;
}

/** Streams results from foliate's `view.search()`; a new query cancels the previous one. */
export function useBookSearch(getView: () => FoliateView | null): BookSearch {
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<BookSearch['status']>('idle');
  const token = useRef(0);

  const clear = useCallback(() => {
    token.current++;
    getView()?.clearSearch();
    setSections([]);
    setProgress(0);
    setStatus('idle');
  }, [getView]);

  const run = useCallback((q: string) => {
    const view = getView();
    const text = q.trim();
    if (!view) return;
    if (!text) return clear();
    const mine = ++token.current;
    setSections([]);
    setProgress(0);
    setStatus('searching');
    void (async () => {
      try {
        const iter = view.search({ query: text, matchCase: false, matchDiacritics: false, matchWholeWords: false });
        for await (const r of iter) {
          if (mine !== token.current) return; // superseded; the new search already cleared highlights
          if (r === 'done') break;
          if ('progress' in r) setProgress(r.progress);
          else if ('subitems' in r) {
            const s = r as FoliateSearchSection;
            setSections((prev) => [...prev, { label: s.label, subitems: s.subitems }]);
          }
        }
        if (mine === token.current) setStatus('done');
      } catch (e) {
        console.error(e);
        if (mine === token.current) setStatus('done');
      }
    })();
  }, [getView, clear]);

  const count = sections.reduce((n, s) => n + s.subitems.length, 0);
  return { query, setQuery, sections, count, progress, status, run, clear };
}

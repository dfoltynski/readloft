// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAsync } from '../../lib/hooks';
import { useOnSynced } from '../../lib/sync';

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setMatch(mq.matches);
    mq.addEventListener('change', h);
    h();
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return match;
}

/** Notes/highlights per book (and in total), reloaded after a sync. */
export function useNoteCounts(reloadKey: unknown = 0) {
  const all = useAsync(() => api.searchAnnotations().catch(() => []), [reloadKey]);
  useOnSynced(all.reload);
  const byBook = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all.data ?? []) m.set(a.bookId, (m.get(a.bookId) ?? 0) + 1);
    return m;
  }, [all.data]);
  return { total: all.data?.length ?? 0, byBook, loaded: !!all.data };
}

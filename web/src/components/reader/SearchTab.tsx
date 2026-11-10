import { useEffect, useRef } from 'react';
import type { FoliateSearchExcerpt } from '../../foliate';
import type { BookSearch } from './useBookSearch';

function Excerpt({ e }: { e: FoliateSearchExcerpt }) {
  return (
    <span className="search-excerpt">
      {e.pre}<mark>{e.match}</mark>{e.post}
    </span>
  );
}

interface Props {
  search: BookSearch;
  onJump: (cfi: string) => void;
  /** Bumped by the parent (Ctrl+F) to refocus the input. */
  focusToken: number;
}

export default function SearchTab({ search, onJump, focusToken }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  return (
    <div className="search-tab">
      <form
        className="search-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          search.run(search.query);
        }}
      >
        <input
          ref={input}
          type="search"
          placeholder="Search in book"
          aria-label="Search in book"
          value={search.query}
          onChange={(ev) => {
            search.setQuery(ev.target.value);
            if (!ev.target.value) search.clear();
          }}
        />
      </form>
      {search.status === 'searching' && (
        <div className="search-status" role="status">
          Searching… {Math.round(search.progress * 100)}% · {search.count} found
        </div>
      )}
      {search.status === 'done' && (
        <div className="search-status" role="status">
          {search.count === 0 ? 'No results' : `${search.count} result${search.count === 1 ? '' : 's'}`}
        </div>
      )}
      <ul className="search-results">
        {search.sections.map((s, i) => (
          <li key={i}>
            {s.label && <div className="search-section">{s.label}</div>}
            {s.subitems.map((item) => (
              <button key={item.cfi} className="search-hit" onClick={() => onJump(item.cfi)}>
                <Excerpt e={item.excerpt} />
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

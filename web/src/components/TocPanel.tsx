import { useEffect, useRef } from 'react';
import type { Bookmark } from '@shared/types';
import type { FoliateTocItem } from '../foliate';
import BookmarksTab from './reader/BookmarksTab';
import SearchTab from './reader/SearchTab';
import type { BookSearch } from './reader/useBookSearch';
import { IconClose } from './Icons';

export type PanelTab = 'contents' | 'bookmarks' | 'search';

const TABS: [PanelTab, string][] = [['contents', 'Contents'], ['bookmarks', 'Bookmarks'], ['search', 'Search']];

interface Props {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  toc: FoliateTocItem[];
  currentHref: string | undefined;
  bookmarks: Bookmark[];
  search: BookSearch;
  /** Incremented to ask the search input to take focus. */
  searchFocusToken: number;
  onSelect: (href: string) => void;
  onJumpLocation: (location: string) => void;
  onDeleteBookmark: (id: string) => void;
  onRenameBookmark: (id: string, label: string) => Promise<void>;
  onClose: () => void;
}

export default function TocPanel({
  tab, onTab, toc, currentHref, bookmarks, search, searchFocusToken,
  onSelect, onJumpLocation, onDeleteBookmark, onRenameBookmark, onClose,
}: Props) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (tab === 'contents') current.current?.scrollIntoView({ block: 'center' });
  }, [tab]);

  const renderItems = (items: FoliateTocItem[], depth: number) => (
    <ul className="toc-list">
      {items.map((item, i) => {
        const active = !!currentHref && item.href === currentHref;
        return (
          <li key={`${item.href}-${i}`}>
            <button
              ref={active ? current : undefined}
              className={`toc-item${active ? ' active' : ''}`}
              style={{ paddingLeft: 16 + depth * 14 }}
              aria-current={active ? 'location' : undefined}
              onClick={() => onSelect(item.href)}
            >
              {item.label.trim()}
            </button>
            {item.subitems && item.subitems.length > 0 && renderItems(item.subitems, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside className="reader-panel reader-toc" aria-label="Book navigation">
      <div className="panel-head">
        <div className="panel-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => onTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="icon-btn" aria-label="Close panel" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="panel-body">
        {tab === 'contents' && (toc.length === 0 ? <p className="muted pad">No table of contents.</p> : renderItems(toc, 0))}
        {tab === 'bookmarks' && (
          <BookmarksTab bookmarks={bookmarks} onJump={onJumpLocation} onDelete={onDeleteBookmark} onRename={onRenameBookmark} />
        )}
        {tab === 'search' && <SearchTab search={search} onJump={onJumpLocation} focusToken={searchFocusToken} />}
      </div>
    </aside>
  );
}

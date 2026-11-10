import { useState } from 'react';
import type { Bookmark } from '@shared/types';
import { formatPercent } from '../../lib/format';
import { IconPencil, IconTrash } from './ReaderIcons';

interface Props {
  bookmarks: Bookmark[];
  onJump: (location: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => Promise<void>;
}

export default function BookmarksTab({ bookmarks, onJump, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (bookmarks.length === 0) {
    return <p className="muted pad">No bookmarks yet. Press B to bookmark the current page.</p>;
  }

  const startEdit = (b: Bookmark) => {
    setError(null);
    setDraft(b.label);
    setEditingId(b.id);
  };
  const cancel = () => setEditingId(null);
  const commit = (b: Bookmark) => {
    if (editingId !== b.id) return; // already committed/cancelled (blur after Enter/Esc)
    setEditingId(null);
    const next = draft.trim().slice(0, 300);
    if (!next || next === b.label) return;
    onRename(b.id, next).catch(() => setError('Could not rename bookmark. Please try again.'));
  };

  return (
    <>
      {error && <p className="bookmark-error" role="alert">{error}</p>}
      <ul className="toc-list">
        {bookmarks.map((b) => (
          <li key={b.id} className="bookmark-row">
            {editingId === b.id ? (
              <input
                className="bookmark-edit"
                aria-label="Bookmark name"
                autoFocus
                maxLength={300}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => commit(b)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit(b); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
                }}
              />
            ) : (
              <>
                <button className="toc-item" onClick={() => onJump(b.location)} onDoubleClick={() => startEdit(b)}>
                  <span className="bookmark-label">{b.label || 'Bookmark'}</span>
                  <span className="bookmark-meta">{formatPercent(b.progress)}</span>
                </button>
                <button className="icon-btn" aria-label="Rename bookmark" title="Rename" onClick={() => startEdit(b)}>
                  <IconPencil />
                </button>
              </>
            )}
            <button className="icon-btn" aria-label={`Delete bookmark ${b.label}`} onClick={() => onDelete(b.id)}>
              <IconTrash />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

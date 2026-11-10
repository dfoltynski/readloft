import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Book, BookPatch, BookStatus } from '@shared/types';
import { api, fileUrl } from '../api';
import Cover from '../components/Cover';
import DeleteBookDialog from '../components/DeleteBookDialog';
import { IconBack, IconDownload } from '../components/Icons';
import { useToast } from '../components/Toast';
import { authorLine, formatBytes, formatDate, formatPercent, formatRelative, seriesLine, splitParagraphs } from '../lib/format';
import { useAsync } from '../lib/hooks';

export default function BookPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const book = useAsync(() => api.getBook(id), [id]);
  const shelves = useAsync(() => api.listShelves(), []);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = book.data ? `${book.data.title} · Readloft` : 'Readloft';
    return () => {
      document.title = 'Readloft';
    };
  }, [book.data]);

  const b = book.data;
  const guard = async (fn: () => Promise<Book | unknown>) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'id' in r) book.setData(r as Book);
      else book.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (book.error) {
    return (
      <div className="page-narrow">
        <Link to="/" className="btn btn-quiet"><IconBack /> Library</Link>
        <div className="notice notice-error">{book.error.message}</div>
      </div>
    );
  }
  if (!b) return <div className="page-narrow muted">Loading…</div>;

  const series = seriesLine(b);
  const hasProgress = b.progress > 0 && b.status !== 'unread';

  return (
    <div className="page-narrow">
      <Link to="/" className="btn btn-quiet back-link"><IconBack /> Library</Link>

      <div className="detail">
        <div className="detail-cover">
          <Cover book={b} large />
          <button className="btn btn-quiet" onClick={() => coverInput.current?.click()}>Change cover</button>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void guard(() => api.setCover(b.id, f));
            }}
          />
        </div>

        <div className="detail-main">
          <h1 className="detail-title">{b.title}</h1>
          <p className="detail-authors">{authorLine(b) || 'Unknown author'}</p>
          {series && <p className="muted">{series}</p>}

          <div className="detail-actions">
            <Link to={`/read/${b.id}`} className="btn btn-primary">
              {hasProgress ? `Continue (${formatPercent(b.progress)})` : 'Read'}
            </Link>
            <a className="btn" href={fileUrl(b.id)} download={`${b.title}.${b.format}`}>
              <IconDownload size={16} /> Download
            </a>
            <button
              className="btn"
              onClick={() => guard(() => api.patchBook(b.id, { status: b.status === 'finished' ? 'unread' : 'finished' }))}
            >
              {b.status === 'finished' ? 'Mark unread' : 'Mark as finished'}
            </button>
            <button className="btn" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              Edit metadata
            </button>
            <button className="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>

          {hasProgress && (
            <div className="progress-bar" role="progressbar" aria-label="Reading progress" aria-valuenow={Math.round(b.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: formatPercent(b.progress) }} />
            </div>
          )}
          <p className="muted read-info">{readInfo(b)}</p>

          {editing ? (
            <EditForm
              book={b}
              onCancel={() => setEditing(false)}
              onSave={async (patch) => {
                await guard(() => api.patchBook(b.id, patch));
                setEditing(false);
              }}
            />
          ) : (
            <>
              {b.description && (
                <div className="description">
                  {splitParagraphs(stripHtml(b.description)).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
              <dl className="fields">
                <Field label="Format" value={`${b.format.toUpperCase()} · ${formatBytes(b.fileSize)}`} />
                <Field label="Publisher" value={b.publisher} />
                <Field label="Published" value={b.publishedAt} />
                <Field label="Language" value={b.language} />
                <Field label="ISBN" value={b.isbn} />
                <Field label="Added" value={formatDate(b.addedAt)} />
                <Field label="Last opened" value={formatDate(b.lastOpenedAt)} />
              </dl>
            </>
          )}

          <div className="detail-section">
            <label className="field-label" htmlFor="status">Status</label>
            <select
              id="status"
              className="select"
              value={b.status}
              onChange={(e) => guard(() => api.patchBook(b.id, { status: e.target.value as BookStatus }))}
            >
              <option value="unread">Unread</option>
              <option value="reading">Reading</option>
              <option value="finished">Finished</option>
            </select>
          </div>

          <div className="detail-section">
            <div className="field-label">Shelves</div>
            {(shelves.data ?? []).length === 0 && <p className="muted">No shelves yet. Create one from the library sidebar.</p>}
            {(shelves.data ?? []).map((s) => {
              const member = b.shelfIds.includes(s.id);
              return (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={member}
                    onChange={async () => {
                      try {
                        await (member ? api.removeFromShelf(s.id, b.id) : api.addToShelf(s.id, b.id));
                        book.reload();
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      }
                    }}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <DeleteBookDialog
          book={b}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async (deleteFile) => {
            setConfirmDelete(false);
            try {
              await api.deleteBook(b.id, deleteFile);
              navigate('/');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}

/** Progress-based summary: "42% read · last opened 3 days ago · added Jan 5, 2026". */
function readInfo(b: Book): string {
  const parts: string[] = [];
  if (b.status === 'finished') parts.push('Finished');
  else if (b.progress > 0) parts.push(`${formatPercent(b.progress)} read`);
  else parts.push('Not started');
  const opened = formatRelative(b.lastOpenedAt);
  if (opened) parts.push(`last opened ${opened}`);
  if (b.addedAt) parts.push(`added on ${formatDate(b.addedAt)}`);
  return parts.join(' · ');
}

/** Descriptions often contain HTML from the ebook metadata; show plain text. */
function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EditForm({ book, onSave, onCancel }: { book: Book; onSave: (p: BookPatch) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '').trim();
    const orNull = (k: string) => str(k) || null;
    const idx = str('seriesIndex');
    setSaving(true);
    await onSave({
      title: str('title') || book.title,
      authors: str('authors').split(',').map((a) => a.trim()).filter(Boolean),
      series: orNull('series'),
      seriesIndex: idx !== '' && !Number.isNaN(Number(idx)) ? Number(idx) : null,
      description: orNull('description'),
      publisher: orNull('publisher'),
      language: orNull('language'),
      publishedAt: orNull('publishedAt'),
      isbn: orNull('isbn'),
    });
    setSaving(false);
  };

  return (
    <form className="edit-form" onSubmit={submit}>
      <label>Title<input name="title" defaultValue={book.title} required /></label>
      <label>Authors (comma-separated)<input name="authors" defaultValue={book.authors.join(', ')} /></label>
      <div className="form-row">
        <label>Series<input name="series" defaultValue={book.series ?? ''} /></label>
        <label>Series #<input name="seriesIndex" type="number" step="any" defaultValue={book.seriesIndex ?? ''} /></label>
      </div>
      <label>Description<textarea name="description" rows={5} defaultValue={book.description ?? ''} /></label>
      <div className="form-row">
        <label>Publisher<input name="publisher" defaultValue={book.publisher ?? ''} /></label>
        <label>Published<input name="publishedAt" defaultValue={book.publishedAt ?? ''} /></label>
      </div>
      <div className="form-row">
        <label>Language<input name="language" defaultValue={book.language ?? ''} /></label>
        <label>ISBN<input name="isbn" defaultValue={book.isbn ?? ''} /></label>
      </div>
      <div className="detail-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>Save</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

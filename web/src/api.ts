import type {
  Book, BookPatch, Bookmark, BookStatus, LibraryStats, ProgressUpdate, ScanResult, Shelf,
} from '@shared/types';

export type BookSort = 'added' | 'title' | 'author' | 'recent';

export interface BookQuery {
  q?: string;
  shelf?: string;
  status?: BookStatus;
  sort?: BookSort;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const coverUrl = (book: Pick<Book, 'id' | 'updatedAt'>) =>
  `/api/books/${book.id}/cover?v=${encodeURIComponent(book.updatedAt)}`;
export const fileUrl = (id: string) => `/api/books/${id}/file`;

export const api = {
  listBooks(query: BookQuery = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    return request<Book[]>(`/api/books?${p}`);
  },
  getBook: (id: string) => request<Book>(`/api/books/${id}`),
  patchBook: (id: string, patch: BookPatch) =>
    request<Book>(`/api/books/${id}`, json('PATCH', patch)),
  deleteBook: (id: string, deleteFile = false) =>
    request<{ ok: true }>(`/api/books/${id}${deleteFile ? '?file=1' : ''}`, { method: 'DELETE' }),
  setCover(id: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return request<Book>(`/api/books/${id}/cover`, { method: 'PUT', body: form });
  },
  putProgress: (id: string, update: ProgressUpdate) =>
    request<Book>(`/api/books/${id}/progress`, json('PUT', update)),
  /** Fire-and-forget progress save that survives page unload. */
  saveProgressKeepalive(id: string, update: ProgressUpdate) {
    fetch(`/api/books/${id}/progress`, { ...json('PUT', update), keepalive: true }).catch(() => {});
  },
  scan: () => request<ScanResult>('/api/scan', { method: 'POST' }),
  listShelves: () => request<Shelf[]>('/api/shelves'),
  createShelf: (name: string) => request<Shelf>('/api/shelves', json('POST', { name })),
  renameShelf: (id: string, name: string) =>
    request<Shelf>(`/api/shelves/${id}`, json('PATCH', { name })),
  deleteShelf: (id: string) => request<{ ok: true }>(`/api/shelves/${id}`, { method: 'DELETE' }),
  addToShelf: (shelfId: string, bookId: string) =>
    request<{ ok: true }>(`/api/shelves/${shelfId}/books/${bookId}`, { method: 'PUT' }),
  removeFromShelf: (shelfId: string, bookId: string) =>
    request<{ ok: true }>(`/api/shelves/${shelfId}/books/${bookId}`, { method: 'DELETE' }),
  listBookmarks: (bookId: string) => request<Bookmark[]>(`/api/books/${bookId}/bookmarks`),
  createBookmark: (bookId: string, b: { location: string; label: string; progress: number }) =>
    request<Bookmark>(`/api/books/${bookId}/bookmarks`, json('POST', b)),
  renameBookmark: (id: string, label: string) =>
    request<Bookmark>(`/api/bookmarks/${id}`, json('PATCH', { label })),
  deleteBookmark: (id: string) => request<{ ok: true }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  stats: () => request<LibraryStats>('/api/stats'),
};

/** Upload files with progress (XMLHttpRequest, since fetch has no upload progress). */
export function uploadFiles(
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<{ added: Book[]; skipped: string[] }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onload = () => {
      let body: { error?: string; added?: Book[]; skipped?: string[] } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ added: body.added ?? [], skipped: body.skipped ?? [] });
      } else {
        reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
      }
    };
    xhr.send(form);
  });
}

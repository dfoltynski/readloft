// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Annotation, AnnotationColor, AnnotationWithBook, Book, BookAvailability, BookPatch, Bookmark, BookStatus, LibraryStats, ProgressUpdate, ScanResult, Shelf, SyncStatus,
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
  getAvailability: (id: string) => request<BookAvailability>(`/api/books/${id}/availability`),
  startDownload: (id: string) => request<BookAvailability>(`/api/books/${id}/download`, { method: 'POST' }),
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
  addBooksToShelf: (shelfId: string, bookIds: string[]) =>
    request<{ added: number }>(`/api/shelves/${shelfId}/books`, json('POST', { bookIds })),
  removeBooksFromShelf: (shelfId: string, bookIds: string[]) =>
    request<{ removed: number }>(`/api/shelves/${shelfId}/books/remove`, json('POST', { bookIds })),
  listBookmarks: (bookId: string) => request<Bookmark[]>(`/api/books/${bookId}/bookmarks`),
  createBookmark: (bookId: string, b: { location: string; label: string; progress: number }) =>
    request<Bookmark>(`/api/books/${bookId}/bookmarks`, json('POST', b)),
  renameBookmark: (id: string, label: string) =>
    request<Bookmark>(`/api/bookmarks/${id}`, json('PATCH', { label })),
  deleteBookmark: (id: string) => request<{ ok: true }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  listAnnotations: (bookId: string) => request<Annotation[]>(`/api/books/${bookId}/annotations`),
  createAnnotation: (
    bookId: string,
    a: { cfi: string; text: string; note?: string; color?: AnnotationColor; progress: number; chapter?: string | null; id?: string },
  ) => request<Annotation>(`/api/books/${bookId}/annotations`, json('POST', a)),
  patchAnnotation: (id: string, patch: { note?: string; color?: AnnotationColor }) =>
    request<Annotation>(`/api/annotations/${id}`, json('PATCH', patch)),
  deleteAnnotation: (id: string) => request<{ ok: true }>(`/api/annotations/${id}`, { method: 'DELETE' }),
  searchAnnotations(query: { q?: string; color?: string; kind?: string; sort?: string } = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    return request<AnnotationWithBook[]>(`/api/annotations?${p}`);
  },
  stats: () => request<LibraryStats>('/api/stats'),
  syncStatus: () => request<SyncStatus>('/api/sync'),
  syncNow: () => request<SyncStatus>('/api/sync', { method: 'POST' }),
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

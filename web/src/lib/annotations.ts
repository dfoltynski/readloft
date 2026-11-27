// SPDX-License-Identifier: AGPL-3.0-only
import type { Annotation, AnnotationColor, AnnotationWithBook } from '@shared/types';

export const ANNOTATION_COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink'];

export const COLOR_HEX: Record<AnnotationColor, string> = {
  yellow: '#e8c65a',
  green: '#7cc49a',
  blue: '#6fa8dc',
  pink: '#e48aa8',
};

export const COLOR_LABEL: Record<AnnotationColor, string> = {
  yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink',
};

/** "14 Nov" (adds the year when it is not the current one). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** "Ch. X · 38% · 14 Nov" */
export function annotationMeta(a: Annotation): string {
  return [a.chapter ? `Ch. ${a.chapter}` : '', pct(a.progress), shortDate(a.createdAt)].filter(Boolean).join(' · ');
}

function quote(text: string): string {
  return text.split(/\n+/).map((l) => `> ${l.trim()}`).join('\n');
}

function entryMarkdown(a: Annotation): string {
  const meta = [pct(a.progress), shortDate(a.createdAt)].filter(Boolean).join(' · ');
  const lines = [quote(a.text || '(no text)')];
  if (a.note) lines.push('', a.note);
  lines.push('', `— ${meta}${a.note ? '' : ' · highlight'}`);
  return lines.join('\n');
}

/** Markdown for one book's annotations (already in the desired order). */
export function bookNotesMarkdown(title: string, authors: string[], list: Annotation[], level = 1): string {
  const h = '#'.repeat(level);
  const out = [`${h} ${title}`];
  if (authors.length) out.push('', `*${authors.join(', ')}*`);
  let chapter: string | null | undefined;
  for (const a of list) {
    if (a.chapter !== chapter) {
      chapter = a.chapter;
      out.push('', `${'#'.repeat(level + 1)} ${chapter ?? 'Untitled section'}`);
    }
    out.push('', entryMarkdown(a));
  }
  return out.join('\n') + '\n';
}

/** Markdown for notes across books, grouped by book (first-seen order). */
export function libraryNotesMarkdown(list: AnnotationWithBook[]): string {
  const groups = new Map<string, AnnotationWithBook[]>();
  for (const a of list) {
    const g = groups.get(a.bookId);
    if (g) g.push(a);
    else groups.set(a.bookId, [a]);
  }
  const parts = ['# Readloft notes\n'];
  for (const g of groups.values()) {
    const sorted = [...g].sort((x, y) => x.progress - y.progress);
    parts.push(bookNotesMarkdown(g[0].bookTitle, g[0].bookAuthors, sorted, 2));
  }
  return parts.join('\n');
}

/** Client-side download of a text file. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type AnnotationKindFilter = 'all' | 'notes' | 'highlights';

/** Filter used by both the reader panel and the library page. */
export function matchesFilter(
  a: Annotation, q: string, kind: AnnotationKindFilter, color: AnnotationColor | '',
): boolean {
  if (kind === 'notes' && !a.note) return false;
  if (kind === 'highlights' && a.note) return false;
  if (color && a.color !== color) return false;
  if (q) {
    const needle = q.toLowerCase();
    if (!a.text.toLowerCase().includes(needle) && !a.note.toLowerCase().includes(needle)) return false;
  }
  return true;
}

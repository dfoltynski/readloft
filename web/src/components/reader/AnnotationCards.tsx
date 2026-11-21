import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Annotation, AnnotationColor } from '@shared/types';
import { ANNOTATION_COLORS, COLOR_HEX, COLOR_LABEL, annotationMeta } from '../../lib/annotations';
import { IconClose } from '../Icons';
import { IconPencil, IconSpeaker, IconTrash } from './ReaderIcons';
import type { ComposerState, HoverState, PeekState, SelInfo } from './useAnnotations';

function ColorDots({ value, onPick, label }: { value?: AnnotationColor; onPick: (c: AnnotationColor) => void; label: string }) {
  return (
    <div className="ann-dots" role="group" aria-label={label}>
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`ann-dot${value === c ? ' active' : ''}`}
          style={{ ['--c' as string]: COLOR_HEX[c] } as CSSProperties}
          aria-label={`${COLOR_LABEL[c]} highlight`}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

const cardTop = (y: number) => Math.max(64, Math.min(y - 24, window.innerHeight - 300));

/** Floating toolbar above a text selection. */
export function SelectionToolbar({ sel, onColor, onNote, onCopy, onRead, onDelete, canRead }: {
  sel: SelInfo;
  onColor: (c: AnnotationColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onRead: () => void;
  onDelete: () => void;
  canRead: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const cx = (sel.rect.left + sel.rect.right) / 2;
    const above = sel.rect.top - h - 10;
    setPos({
      left: Math.max(8, Math.min(cx - w / 2, window.innerWidth - w - 8)),
      top: above >= 56 ? above : sel.rect.bottom + 10,
    });
  }, [sel]);
  const existing = !!sel.existingId;
  return (
    <div
      ref={ref}
      className="ann-toolbar"
      role="toolbar"
      aria-label="Selection"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {existing ? (
        <>
          <button className="ann-tb-btn" onClick={onNote}>Edit note</button>
          <span className="ann-sep" />
          <ColorDots label="Change color" onPick={onColor} />
          <span className="ann-sep" />
          <button className="ann-tb-btn danger" onClick={onDelete}>Delete</button>
        </>
      ) : (
        <>
          <ColorDots label="Highlight color" onPick={onColor} />
          <span className="ann-sep" />
          <button className="ann-tb-btn primary" onClick={onNote}>Add note <kbd>N</kbd></button>
          <button className="ann-tb-btn" onClick={onCopy}>Copy</button>
          {canRead && (
            <button className="icon-btn" aria-label="Read aloud from here" onClick={onRead}><IconSpeaker /></button>
          )}
        </>
      )}
    </div>
  );
}

function Quote({ text, color }: { text: string; color: AnnotationColor }) {
  return <blockquote className="ann-quote" style={{ borderLeftColor: COLOR_HEX[color] }}>{text}</blockquote>;
}

/** Note editor docked at the right of the reader. */
export function Composer({ state, quote, onChange, onSave, onCancel }: {
  state: ComposerState;
  quote: string;
  onChange: (patch: { note?: string; color?: AnnotationColor }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    area.current?.focus();
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) saveRef.current();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);
  return (
    <div ref={ref} className="ann-card" role="dialog" aria-label="Note" style={{ top: cardTop(state.y) }}>
      <Quote text={quote} color={state.color} />
      <textarea
        ref={area}
        className="ann-textarea"
        rows={4}
        placeholder="Add a note…"
        value={state.note}
        onChange={(e) => onChange({ note: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
      />
      <div className="ann-card-row">
        <ColorDots value={state.color} label="Color" onPick={(color) => onChange({ color })} />
        <span className="ann-grow" />
        <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={onSave}>Save <kbd>⌘↵</kbd></button>
      </div>
    </div>
  );
}

/** Read-only card shown when an annotation is clicked. */
export function PeekCard({ annotation, peek, count, onEdit, onDelete, onClose, onOpenPanel }: {
  annotation: Annotation;
  peek: PeekState;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onOpenPanel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);
  return (
    <div ref={ref} className="ann-card" role="dialog" aria-label="Annotation" style={{ top: cardTop(peek.y) }}>
      <div className="ann-card-head">
        <span className="ann-meta">{annotationMeta(annotation)}</span>
        <span className="ann-grow" />
        <button className="icon-btn" aria-label="Edit note" onClick={onEdit}><IconPencil /></button>
        <button className="icon-btn" aria-label="Delete annotation" onClick={onDelete}><IconTrash /></button>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose size={16} /></button>
      </div>
      <Quote text={annotation.text} color={annotation.color} />
      {annotation.note
        ? <p className="ann-note">{annotation.note}</p>
        : <p className="ann-note muted">Highlight only. <button className="ann-link" onClick={onEdit}>Add a note</button></p>}
      <button className="ann-link ann-foot" onClick={onOpenPanel}>All notes in this book ({count})</button>
    </div>
  );
}

export function HoverTip({ hover }: { hover: HoverState }) {
  const text = hover.text.split('\n')[0];
  return (
    <div className="ann-hover" style={{ left: Math.min(hover.x + 12, window.innerWidth - 280), top: hover.y + 18 }}>
      {text.length > 90 ? `${text.slice(0, 90)}…` : text}
    </div>
  );
}

import { useState } from 'react';
import type { Book } from '@shared/types';

interface Props {
  book: Book;
  onCancel: () => void;
  onConfirm: (deleteFile: boolean) => void;
}

export default function DeleteBookDialog({ book, onCancel, onConfirm }: Props) {
  const [deleteFile, setDeleteFile] = useState(false);
  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="del-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2 id="del-title">Delete “{book.title}”?</h2>
        <p className="muted">This removes the book from your library.</p>
        <label className="check">
          <input type="checkbox" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
          Also delete the file from disk
        </label>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(deleteFile)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

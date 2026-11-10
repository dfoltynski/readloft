const SHORTCUTS: [string, string][] = [
  ['/', 'Focus search'],
  ['Esc', 'Clear and leave search'],
  ['u', 'Upload books'],
  ['?', 'Show this help'],
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="shortcut">
              <dt><kbd>{key}</kbd></dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </div>
  );
}

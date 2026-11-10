const SHORTCUTS: [string, string][] = [
  ['← / →', 'Previous / next page'],
  ['Space / Shift+Space', 'Next / previous page'],
  ['PageUp / PageDown', 'Previous / next page'],
  ['T', 'Table of contents'],
  ['B', 'Toggle bookmark'],
  ['Ctrl/Cmd + F', 'Search in book'],
  ['F', 'Fullscreen'],
  ['?', 'This help'],
  ['Esc', 'Close panels'],
];

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="reader-help-scrim" onClick={onClose}>
      <div className="reader-help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([k, d]) => (
            <div key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

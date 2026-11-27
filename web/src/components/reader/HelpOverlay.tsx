// SPDX-License-Identifier: AGPL-3.0-only
import { READER_SHORTCUTS, type ShortcutGroup } from '../../lib/shortcuts';

export default function HelpOverlay({ onClose, groups = READER_SHORTCUTS }: { onClose: () => void; groups?: ShortcutGroup[] }) {
  return (
    <div className="reader-help-scrim" onClick={onClose}>
      <div className="reader-help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="help-groups">
          {groups.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.items.map(([k, d]) => (
                  <div key={k + d}>
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

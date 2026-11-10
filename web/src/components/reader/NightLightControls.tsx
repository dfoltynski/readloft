import { useNightLight, type NightLightMode } from '../../lib/nightLight';

/** Night light section of the reader settings panel. */
export default function NightLightControls() {
  const { settings: n, update } = useNightLight();
  const modes: [string, NightLightMode][] = [['Off', 'off'], ['On', 'on'], ['Scheduled', 'schedule']];
  return (
    <>
      <div className="setting-row">
        <div className="setting-label">Blue light filter</div>
        <div className="segmented" role="group" aria-label="Blue light filter">
          {modes.map(([text, v]) => (
            <button key={v} className={n.mode === v ? 'active' : ''} aria-pressed={n.mode === v} onClick={() => update({ mode: v })}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {n.mode !== 'off' && (
        <div className="setting-row">
          <div className="setting-label">Filter strength</div>
          <div className="slider-row">
            <input type="range" aria-label="Filter strength" min={0} max={100} step={5} value={n.strength}
              onChange={(e) => update({ strength: Number(e.target.value) })} />
            <span className="slider-value">{n.strength}%</span>
          </div>
        </div>
      )}
      {n.mode === 'schedule' && (
        <div className="setting-row">
          <div className="setting-label">Active from / to</div>
          <div className="time-row">
            <input type="time" aria-label="From" value={n.from} onChange={(e) => e.target.value && update({ from: e.target.value })} />
            <span>–</span>
            <input type="time" aria-label="To" value={n.to} onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </div>
        </div>
      )}
      <div className="setting-row">
        <div className="setting-label">Brightness reduction</div>
        <div className="slider-row">
          <input type="range" aria-label="Brightness reduction" min={0} max={80} step={5} value={n.dim}
            onChange={(e) => update({ dim: Number(e.target.value) })} />
          <span className="slider-value">{n.dim}%</span>
        </div>
      </div>
    </>
  );
}

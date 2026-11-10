import type { ReactNode } from 'react';
import NightLightControls from './reader/NightLightControls';
import { wakeLockSupported } from './reader/useWakeLock';
import type { ReaderFont, ReaderSettings, ReaderTheme } from '../lib/readerSettings';

interface Props {
  settings: ReaderSettings;
  fixedLayout: boolean;
  onChange: (patch: Partial<ReaderSettings>) => void;
}

function Choice<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: [string, T][]; onChange: (v: T) => void }) {
  return (
    <Row label={label}>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([text, v]) => (
          <button key={v} className={value === v ? 'active' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label}</div>
      {children}
    </div>
  );
}

function Slider({
  label, value, min, max, step, format, onChange,
}: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <div className="slider-row">
        <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-value">{format(value)}</span>
      </div>
    </Row>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row setting-toggle">
      <span className="setting-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function ReaderSettingsPanel({ settings: s, fixedLayout, onChange }: Props) {
  return (
    <div className="reader-popover" role="dialog" aria-label="Reader settings">
      <Choice<ReaderTheme>
        label="Theme"
        value={s.theme}
        onChange={(theme) => onChange({ theme })}
        options={[['Light', 'light'], ['Paper', 'paper'], ['Sepia', 'sepia'], ['Dark', 'dark'], ['Black', 'black'], ['App', 'app']]}
      />
      {fixedLayout ? (
        <p className="muted small">This format has a fixed layout; only the theme background applies.</p>
      ) : (
        <>
          <Choice<ReaderFont>
            label="Font"
            value={s.font}
            onChange={(font) => onChange({ font })}
            options={[['Default', 'default'], ['Serif', 'serif'], ['Sans', 'sans']]}
          />
          <Slider label="Font size" value={s.fontSize} min={80} max={200} step={5} format={(v) => `${v}%`} onChange={(fontSize) => onChange({ fontSize })} />
          <Slider label="Line height" value={s.lineHeight} min={1.2} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={(lineHeight) => onChange({ lineHeight })} />
          <Slider label="Max width" value={s.maxWidth} min={480} max={1400} step={20} format={(v) => `${v}px`} onChange={(maxWidth) => onChange({ maxWidth })} />
          <Slider label="Margins" value={s.margin} min={2} max={15} step={1} format={(v) => `${v}%`} onChange={(margin) => onChange({ margin })} />
          <Toggle label="Justify text" value={s.justify} onChange={(justify) => onChange({ justify })} />
          <Toggle label="Hyphenation" value={s.hyphenate} onChange={(hyphenate) => onChange({ hyphenate })} />
          <Choice<ReaderSettings['flow']>
            label="Layout"
            value={s.flow}
            onChange={(flow) => onChange({ flow })}
            options={[['Paginated', 'paginated'], ['Scrolled', 'scrolled']]}
          />
          <Choice<ReaderSettings['columns']>
            label="Columns"
            value={s.columns}
            onChange={(columns) => onChange({ columns })}
            options={[['Auto', 'auto'], ['1', '1']]}
          />
          {s.flow === 'paginated' && (
            <Toggle label="Page-turn animation" value={s.animate} onChange={(animate) => onChange({ animate })} />
          )}
        </>
      )}
      {wakeLockSupported && (
        <Toggle label="Keep screen awake" value={s.keepAwake} onChange={(keepAwake) => onChange({ keepAwake })} />
      )}
      <NightLightControls />
    </div>
  );
}

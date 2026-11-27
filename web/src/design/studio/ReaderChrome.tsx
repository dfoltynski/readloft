// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import NightLightControls from '../../components/reader/NightLightControls';
import { wakeLockSupported } from '../../components/reader/useWakeLock';
import { formatPercent } from '../../lib/format';
import { paletteFor, type ReaderFont, type ReaderSettings, type ReaderTheme } from '../../lib/readerSettings';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import ContextMenu from '../../components/ContextMenu';
import { useTheme } from '../../lib/hooks';
import { openShortcuts } from '../../lib/shortcuts';
import { formatRelative } from '../../lib/format';
import type { SyncStatus } from '@shared/types';
import { SIcon } from './icons';

/* ---------- Dock ---------- */

interface DockProps {
  fraction: number;
  rtl: boolean;
  settings: ReaderSettings;
  fixedLayout: boolean;
  ready: boolean;
  bookmarked: boolean;
  speaking: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  railOpen: boolean;
  asideOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (fraction: number) => void;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReadAloud: () => void;
  onBookmark: () => void;
  onFullscreen: () => void;
  onToggleRail: () => void;
  onToggleAside: () => void;
  /** True while the progress slider is being dragged (keeps the controls visible). */
  onSliderDrag: (dragging: boolean) => void;
}

function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [string, T][]; onChange: (v: T) => void;
}) {
  return (
    <div className="st-dock-group" role="group" aria-label={label}>
      {options.map(([text, v]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function ReaderDock(p: DockProps) {
  const { settings: s } = p;
  return (
    <div className="st-dock" role="toolbar" aria-label="Reader controls">
      <div className="st-dock-group">
        <button type="button" aria-label="Previous page" onClick={p.onPrev}><SIcon.Prev /></button>
        <div className="st-dock-prog">
          <input
            type="range"
            min={0}
            max={1}
            step="any"
            dir={p.rtl ? 'rtl' : 'ltr'}
            aria-label="Reading progress"
            value={p.fraction}
            disabled={!p.ready}
            onPointerDown={() => p.onSliderDrag(true)}
            onPointerUp={() => p.onSliderDrag(false)}
            onPointerCancel={() => p.onSliderDrag(false)}
            onBlur={() => p.onSliderDrag(false)}
            onChange={(e) => p.onSeek(Number(e.target.value))}
          />
          <span>{formatPercent(p.fraction)}</span>
        </div>
        <button type="button" aria-label="Next page" onClick={p.onNext}><SIcon.Next /></button>
      </div>
      {!p.fixedLayout && (
        <Seg<ReaderSettings['flow']>
          label="Layout"
          value={s.flow}
          onChange={(flow) => p.onChange({ flow })}
          options={[['Paged', 'paginated'], ['Scroll', 'scrolled']]}
        />
      )}
      {(p.fixedLayout || s.flow === 'paginated') && (
        <Seg<ReaderSettings['columns']>
          label="Pages"
          value={s.columns}
          onChange={(columns) => p.onChange({ columns })}
          options={[['One', '1'], ['Two', 'auto']]}
        />
      )}
      <div className="st-dock-group">
        <button type="button" aria-label="Read aloud (R)" aria-pressed={p.speaking} className={p.speaking ? 'on' : ''} onClick={p.onReadAloud}>
          <SIcon.Speaker />
        </button>
        <button type="button" aria-label={p.bookmarked ? 'Remove bookmark (B)' : 'Add bookmark (B)'} aria-pressed={p.bookmarked} onClick={p.onBookmark}>
          <SIcon.Bookmark filled={p.bookmarked} />
        </button>
        {p.fullscreenSupported && (
          <button type="button" aria-label={p.fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onClick={p.onFullscreen}>
            <SIcon.Fullscreen exit={p.fullscreen} />
          </button>
        )}
        <button type="button" aria-label="Contents and notes (T)" aria-pressed={p.railOpen} className={p.railOpen ? 'on' : ''} onClick={p.onToggleRail}>
          <SIcon.Contents />
        </button>
        <button type="button" aria-label="Reading settings" aria-pressed={p.asideOpen} className={p.asideOpen ? 'on' : ''} onClick={p.onToggleAside}>
          <SIcon.Sliders />
        </button>
      </div>
    </div>
  );
}

/* ---------- "Reading" settings aside ---------- */

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div>
      <div className="st-row"><span className="st-caps">{label}</span>{value && <span className="st-mono">{value}</span>}</div>
      {children}
    </div>
  );
}

function Stepper({ label, text, onMinus, onPlus, minusDisabled, plusDisabled }: {
  label: string; text: string; onMinus: () => void; onPlus: () => void; minusDisabled: boolean; plusDisabled: boolean;
}) {
  return (
    <div className="st-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={onMinus} disabled={minusDisabled}>−</button>
      <span className="st-mono">{text}</span>
      <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={onPlus} disabled={plusDisabled}>+</button>
    </div>
  );
}

function Check({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="st-check">
      <span><b>{label}</b>{hint && <><br /><span className="st-muted">{hint}</span></>}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const THEMES: [ReaderTheme, string][] = [
  ['light', 'Light'], ['paper', 'Paper'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['black', 'Black'], ['app', 'App'],
];

interface AsideProps {
  settings: ReaderSettings;
  fixedLayout: boolean;
  onChange: (patch: Partial<ReaderSettings>) => void;
  tts: { playing: boolean; idle: boolean; unavailable: string | null; voiceName: string | undefined; onToggle: () => void; rate: number; onRate: (r: number) => void };
}

export function ReaderAside({ settings: s, fixedLayout, onChange, tts }: AsideProps) {
  const font: [string, ReaderFont][] = [['Default', 'default'], ['Serif', 'serif'], ['Sans', 'sans']];
  return (
    <aside className="st-aside" aria-label="Reading settings">
      <h4>Reading</h4>
      <Field label="Theme">
        <div className="st-themes" role="group" aria-label="Theme">
          {THEMES.map(([t, name]) => {
            const pal = paletteFor(t);
            return (
              <button
                key={t}
                type="button"
                className={s.theme === t ? 'on' : ''}
                aria-pressed={s.theme === t}
                aria-label={name}
                data-tip={name}
                style={{ background: pal.bg, color: pal.fg }}
                onClick={() => onChange({ theme: t })}
              >
                Aa
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Pages">
        <div className="st-seg2" role="group" aria-label="Pages">
          {([['One', '1'], ['Two', 'auto']] as [string, ReaderSettings['columns']][]).map(([text, v]) => (
            <button key={v} type="button" className={s.columns === v ? 'on' : ''} aria-pressed={s.columns === v} onClick={() => onChange({ columns: v })}>
              {text}
            </button>
          ))}
        </div>
      </Field>
      {fixedLayout ? (
        <p className="st-muted">This format has a fixed layout; only the theme and page spread apply.</p>
      ) : (
        <>
          <Field label="Font">
            <div className="st-seg3" role="group" aria-label="Font">
              {font.map(([text, v]) => (
                <button key={v} type="button" className={s.font === v ? 'on' : ''} aria-pressed={s.font === v} onClick={() => onChange({ font: v })}>
                  {text}
                </button>
              ))}
            </div>
          </Field>
          <div className="st-two">
            <Field label="Size">
              <Stepper
                label="Size"
                text={`${s.fontSize}%`}
                minusDisabled={s.fontSize <= 80}
                plusDisabled={s.fontSize >= 200}
                onMinus={() => onChange({ fontSize: Math.max(80, s.fontSize - 5) })}
                onPlus={() => onChange({ fontSize: Math.min(200, s.fontSize + 5) })}
              />
            </Field>
            <Field label="Line">
              <Stepper
                label="Line height"
                text={s.lineHeight.toFixed(1)}
                minusDisabled={s.lineHeight <= 1.2}
                plusDisabled={s.lineHeight >= 2}
                onMinus={() => onChange({ lineHeight: Math.max(1.2, Math.round((s.lineHeight - 0.1) * 10) / 10) })}
                onPlus={() => onChange({ lineHeight: Math.min(2, Math.round((s.lineHeight + 0.1) * 10) / 10) })}
              />
            </Field>
          </div>
          <Field label="Margins" value={`${s.margin}%`}>
            <input type="range" aria-label="Margins" min={2} max={15} step={1} value={s.margin} onChange={(e) => onChange({ margin: Number(e.target.value) })} />
          </Field>
          <Field label="Max width" value={`${s.maxWidth} px`}>
            <input type="range" aria-label="Max width" min={480} max={1400} step={20} value={s.maxWidth} onChange={(e) => onChange({ maxWidth: Number(e.target.value) })} />
          </Field>
          <Check label="Justify text" value={s.justify} onChange={(justify) => onChange({ justify })} />
          <Check label="Hyphenation" value={s.hyphenate} onChange={(hyphenate) => onChange({ hyphenate })} />
          {s.flow === 'paginated' && <Check label="Page-turn animation" value={s.animate} onChange={(animate) => onChange({ animate })} />}
        </>
      )}
      <Check label="Auto-hide controls" hint="Show them at the top or bottom edge, or with M" value={s.autoHide} onChange={(autoHide) => onChange({ autoHide })} />
      <Check label="Show highlights in text" hint="Off: only margin marks" value={s.showHighlights} onChange={(showHighlights) => onChange({ showHighlights })} />
      {wakeLockSupported && <Check label="Keep screen awake" value={s.keepAwake} onChange={(keepAwake) => onChange({ keepAwake })} />}
      <div className="st-night"><NightLightControls /></div>

      <div className="st-aside-sep">
        <h4 style={{ marginBottom: 12 }}>Read aloud</h4>
        <div className="st-voice">
          <button
            type="button"
            className="st-play"
            aria-label={tts.playing ? 'Pause (R)' : tts.idle ? 'Read aloud (R)' : 'Resume (R)'}
            aria-disabled={!!tts.unavailable}
            data-tip={tts.unavailable ?? undefined}
            onClick={tts.onToggle}
          >
            {tts.playing ? <SIcon.Pause /> : <SIcon.Play />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="st-ellipsis"><b>{tts.voiceName ?? 'Default voice'}</b></div>
            <div className="st-stat">{tts.unavailable ?? (tts.idle ? 'ready' : tts.playing ? 'reading aloud…' : 'paused')}</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Speed" value={`${tts.rate}×`}>
            <input type="range" aria-label="Speed" min={0.75} max={2} step={0.05} value={tts.rate} onChange={(e) => tts.onRate(Number(e.target.value))} />
          </Field>
        </div>
        <Check label="Pause at images & tables" value={s.ttsPauseAtMedia} onChange={(ttsPauseAtMedia) => onChange({ ttsPauseAtMedia })} />
      </div>
    </aside>
  );
}

/* ---------- Top chrome: back, title, sync, menu ---------- */

interface TopProps {
  title: string;
  chapter: string;
  sync: SyncStatus | null;
  syncing: boolean;
  onSync: () => void;
  autoHide: boolean;
  onAutoHide: (v: boolean) => void;
}

export function ReaderTopChrome({ title, chapter, sync, syncing, onSync, autoHide, onAutoHide }: TopProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [theme, toggleTheme] = useTheme();
  const ok = !!sync?.enabled && !sync.error;
  const tip = !sync ? 'Sync now' : !sync.enabled ? 'Sync is off (SYNC=0)' : sync.error ? `Sync error: ${sync.error}` : `Sync now · last ${formatRelative(sync.lastMergeAt) || 'never'}`;
  return (
    <div className="st-rtop">
      <Link to="/" className="st-icon-btn" aria-label="Back to library" data-tip="Back to library"><SIcon.Back /></Link>
      <div className="st-rtop-title">
        <b className="st-ellipsis">{title}</b>
        {chapter && <span className="st-ellipsis st-muted">{chapter}</span>}
      </div>
      <button type="button" className="st-btn" onClick={onSync} disabled={syncing} aria-label="Sync now" data-tip={tip}>
        <span className={`st-dot${ok ? '' : ' warn'}`} aria-hidden="true" />
        <span className={syncing ? 'st-spin' : undefined}><SIcon.Sync /></span>
        <span className="st-btn-label">{syncing ? 'Syncing' : 'Sync'}</span>
      </button>
      <button
        type="button"
        className="st-icon-btn"
        aria-label="Settings menu"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 200, y: r.bottom + 6 });
        }}
      >
        <SIcon.Gear />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: `${autoHide ? '✓ ' : ''}Auto-hide controls`, onSelect: () => onAutoHide(!autoHide) },
            { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onSelect: toggleTheme },
            { label: 'Keyboard shortcuts', onSelect: openShortcuts },
          ]}
        />
      )}
    </div>
  );
}

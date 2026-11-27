// SPDX-License-Identifier: AGPL-3.0-only
import type { TtsState } from '../../lib/readAloud';
import { IconPause, IconPlay, IconSkip, IconStop } from './ReaderIcons';

interface Props {
  state: TtsState;
  hint: string | null;
  rate: number;
  voices: SpeechSynthesisVoice[];
  voiceURI?: string;
  bookLang?: string;
  lifted: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
  onRate: (r: number) => void;
  onVoice: (uri: string) => void;
  onReveal: () => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export default function ReadAloudBar(p: Props) {
  const { state } = p;
  const base = (p.bookLang || '').toLowerCase().split('-')[0];
  const sorted = [...p.voices].sort((a, b) => {
    const am = a.lang.toLowerCase().startsWith(base) ? 0 : 1;
    const bm = b.lang.toLowerCase().startsWith(base) ? 0 : 1;
    return am - bm || Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name);
  });
  const playing = state.status === 'playing';
  const message = state.error
    ? <span className="tts-msg tts-error" role="alert">{state.error}</span>
    : state.notice
      ? (
        <button className="tts-msg tts-notice" onClick={p.onReveal}>
          {state.notice.label} on this page — tap to view
        </button>
      )
      : p.hint
        ? <span className="tts-msg tts-hint" role="status">{p.hint}</span>
        : <span className="tts-msg muted">{playing ? 'Reading aloud…' : 'Paused'}</span>;

  return (
    <div className={`tts-bar${p.lifted ? ' lifted' : ''}`} role="region" aria-label="Read aloud">
      <div className="tts-row">
        <button className="icon-btn" aria-label="Previous sentence ([)" onClick={p.onPrev}>
          <IconSkip back />
        </button>
        <button className="icon-btn tts-main" aria-label={playing ? 'Pause (R)' : 'Resume (R)'} onClick={p.onToggle}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button className="icon-btn" aria-label="Next sentence (])" onClick={p.onNext}>
          <IconSkip />
        </button>
        <button className="icon-btn" aria-label="Stop reading (Esc)" onClick={p.onStop}>
          <IconStop />
        </button>
        <select className="tts-select" aria-label="Speed" value={p.rate} onChange={(e) => p.onRate(Number(e.target.value))}>
          {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <select className="tts-select tts-voice" aria-label="Voice" value={p.voiceURI ?? ''} onChange={(e) => p.onVoice(e.target.value)}>
          {sorted.length === 0 && <option value="">Default voice</option>}
          {sorted.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang}){v.localService ? '' : ' · online'}
            </option>
          ))}
        </select>
      </div>
      <div className="tts-note">{message}</div>
    </div>
  );
}

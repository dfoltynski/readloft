// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../Toast';
import { PdfSource } from '../../lib/pdfText';
import type { FoliateView } from '../../foliate';
import { pickVoice, ReadAloud, speechSupported, type TtsState } from '../../lib/readAloud';
import type { ReaderSettings } from '../../lib/readerSettings';

const IDLE: TtsState = { status: 'idle', notice: null, error: null };
const HINT_MS = 8000;

const langKey = (lang?: string) => (lang || '').toLowerCase().split('-')[0] || 'default';

/** Voices from speechSynthesis; they load asynchronously in Chrome/Safari (voiceschanged). */
function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported) return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

export function useReadAloud(opts: {
  bookId: string;
  getView: () => FoliateView | null;
  bookLang?: string;
  settings: ReaderSettings;
  patchSettings: (patch: Partial<ReaderSettings>) => void;
  fixedLayout: boolean;
  /** Book file format ('pdf', 'epub', …); PDFs are read through pdf.js. */
  format?: string;
  getFile: () => File | null;
  ready: boolean;
}) {
  const { bookId, getView, bookLang, settings, patchSettings, fixedLayout, format, getFile, ready } = opts;
  const isPdf = format === 'pdf';
  const toast = useToast();
  const voices = useVoices();
  const [state, setState] = useState<TtsState>(IDLE);
  const [hint, setHint] = useState<string | null>(null);
  const engine = useRef<ReadAloud | null>(null);
  const engineView = useRef<FoliateView | null>(null);
  const hintTimer = useRef<number>();

  const key = langKey(bookLang);
  const stored = settings.ttsVoices[key];
  const voice = voices.find((v) => v.voiceURI === stored) ?? pickVoice(voices, bookLang);

  const unavailable = !speechSupported
    ? 'Read aloud isn’t supported by this browser'
    : fixedLayout && !isPdf ? 'Read aloud isn’t available for comics and fixed-layout books' : null;

  const destroy = useCallback(() => {
    engine.current?.destroy();
    engine.current = null;
    engineView.current = null;
    window.clearTimeout(hintTimer.current);
    setHint(null);
    setState(IDLE);
  }, []);

  // Switching books / leaving the reader stops speech.
  useEffect(() => {
    const onHide = () => { if (speechSupported) speechSynthesis.cancel(); };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      destroy();
      if (speechSupported) speechSynthesis.cancel();
    };
  }, [bookId, destroy]);

  useEffect(() => {
    engine.current?.setOptions({ rate: settings.ttsRate, voice, pauseAtMedia: settings.ttsPauseAtMedia });
  }, [settings.ttsRate, settings.ttsPauseAtMedia, voice]);

  const showHint = (text: string) => {
    setHint(text);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS);
  };

  // Engine failures (no text, speech not starting, …) are also shown as a toast so they can't be missed.
  useEffect(() => { if (state.error) toast(state.error, 'error'); }, [state.error, toast]);

  /** Starts at `from`; with no range: the selection, else the top of the visible page. */
  const start = useCallback((from?: Range | null) => {
    const view = getView();
    if (!view || !ready) { toast('The book is still opening — try again in a moment.'); return; }
    if (unavailable) { toast(unavailable, 'error'); return; }
    if (engine.current && engineView.current !== view) destroy();
    if (!engine.current) {
      engine.current = new ReadAloud(
        view,
        { rate: settings.ttsRate, voice, pauseAtMedia: settings.ttsPauseAtMedia },
        setState,
        isPdf
          ? async () => {
              const f = getFile();
              if (!f) throw new Error('The PDF file is not available');
              return PdfSource.open(f);
            }
          : undefined,
        bookLang,
      );
      engineView.current = view;
    }
    if (isPdf) {
      let hintText: string | undefined;
      if (from) setHint(null);
      else {
        for (const c of view.renderer.getContents?.() ?? []) {
          const t = c.doc?.getSelection()?.toString().trim();
          if (t) { hintText = t; break; }
        }
        showHint(hintText ? 'Starting from your selection' : 'Starting from this page — or select text and press R');
      }
      void engine.current.start(from ?? null, hintText);
      return;
    }
    let range = from ?? null;
    if (from) {
      setHint(null);
    } else {
      const doc = view.renderer.getContents?.()[0]?.doc;
      const sel = doc?.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        range = sel.getRangeAt(0).cloneRange();
        showHint('Starting from your selection');
      } else {
        range = view.lastLocation?.range?.cloneRange() ?? null;
        showHint('Starting from this page — or select text and choose “Read from here”');
      }
    }
    void engine.current.start(range);
  }, [getView, unavailable, ready, isPdf, getFile, bookLang, toast, settings.ttsRate, settings.ttsPauseAtMedia, voice, destroy]);

  const toggle = useCallback(() => {
    const e = engine.current;
    if (!e || e.status === 'idle') start();
    else if (e.status === 'playing') e.pause();
    else e.resume();
  }, [start]);

  return {
    state, hint, voices, voice, unavailable, start, toggle,
    prev: () => void engine.current?.step(-1),
    next: () => void engine.current?.step(1),
    stop: () => { engine.current?.stop(); setHint(null); },
    reveal: () => engine.current?.revealNotice(),
    setRate: (ttsRate: number) => patchSettings({ ttsRate }),
    setVoice: (uri: string) => patchSettings({ ttsVoices: { ...settings.ttsVoices, [key]: uri } }),
    dismissError: () => setState((s) => ({ ...s, error: null })),
    langKey: key,
  };
}

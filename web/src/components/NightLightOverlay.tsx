import { useNightLight } from '../lib/nightLight';

/** Max opacity of the amber layer at strength 100. */
const MAX_TINT = 0.45;

const layer = {
  position: 'fixed', inset: 0, pointerEvents: 'none', transition: 'opacity 600ms ease',
} as const;

/**
 * Blue-light filter + dimmer. Mount once anywhere (state is shared through
 * `useNightLight`); it covers the whole viewport and never intercepts input.
 */
export default function NightLightOverlay() {
  const { settings, active } = useNightLight();
  return (
    <>
      <div
        aria-hidden="true"
        data-night-light="tint"
        style={{
          ...layer, zIndex: 2147483000, background: 'rgb(255, 140, 40)', mixBlendMode: 'multiply',
          opacity: active ? (settings.strength / 100) * MAX_TINT : 0,
        }}
      />
      <div
        aria-hidden="true"
        data-night-light="dim"
        style={{ ...layer, zIndex: 2147483001, background: '#000', opacity: active ? settings.dim / 100 : 0 }}
      />
    </>
  );
}

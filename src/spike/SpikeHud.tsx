import { signal } from '@preact/signals';

export const frameCount = signal(0);

export function SpikeHud() {
  return (
    <div id="spike-hud" style={{ position: 'absolute', top: 8, left: 8, pointerEvents: 'auto' }}>
      PolyHeart Engine spike - frames: {frameCount.value}
    </div>
  );
}

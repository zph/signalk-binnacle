import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import VerticalHistoryTile from './VerticalHistoryTile.svelte';

describe('VerticalHistoryTile history window', () => {
  it('changes the window without activating the instrument', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onOpen = vi.fn();
    const onWindowChange = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(VerticalHistoryTile, {
        target,
        props: {
          label: 'True wind speed history',
          reading: { state: 'live', value: '8.0', unit: 'kn', siValue: 4.12 },
          zone: 'normal',
          sensorGloss: 'No true wind data',
          abbr: 'TWS',
          mode: 'speed',
          points: [],
          nowMs: 1_000_000,
          windowMinutes: 10,
          onWindowChange,
          onOpen,
        },
      });
    });

    const slider = target.querySelector<HTMLInputElement>('[aria-label="TWS history window"]');
    if (!slider) throw new Error('Missing TWS history window slider');
    slider.value = '6';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onWindowChange).toHaveBeenCalledWith(1_440);
    expect(onOpen).not.toHaveBeenCalled();
    await unmount(component);
    target.remove();
  });
});

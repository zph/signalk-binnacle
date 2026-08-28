import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DEG_TO_RAD } from '$shared/lib';
import WindRoseSettings from './WindRoseSettings.svelte';

describe('WindRoseSettings', () => {
  it('shows and updates the per-side error arc margin in degrees', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onArcMarginChange = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(WindRoseSettings, {
        target,
        props: {
          noGoAngleRad: 40 * DEG_TO_RAD,
          arcMarginRad: 15 * DEG_TO_RAD,
          onChange: () => {},
          onArcMarginChange,
          onBack: () => {},
        },
      });
    });

    expect(target.textContent).toContain('Margin on each side');
    expect(target.textContent).toContain('15°');
    const slider = target.querySelector<HTMLInputElement>('#wind-rose-arc-margin');
    expect(slider?.getAttribute('aria-valuetext')).toBe(
      '15 degrees on each side, 30 degrees total per arc',
    );
    if (!slider) throw new Error('Missing wind rose arc margin slider');
    slider.value = '10';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onArcMarginChange).toHaveBeenCalledWith(10 * DEG_TO_RAD);
    await unmount(component);
    target.remove();
  });
});

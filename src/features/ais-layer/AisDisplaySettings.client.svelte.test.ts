import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AisDisplaySettings from './AisDisplaySettings.svelte';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('AisDisplaySettings', () => {
  it('shows the selected symbol mode and forwards a mode change', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onModeChange = vi.fn();
    const onRetentionMinutesChange = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(AisDisplaySettings, {
        target,
        props: {
          mode: 'type-specific',
          onModeChange,
          retentionMinutes: 60,
          onRetentionMinutesChange,
        },
      });
    });
    dispose = () => {
      void unmount(component);
      target.remove();
    };

    const buttons = [...target.querySelectorAll<HTMLButtonElement>('button')];
    expect(target.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'AIS vessel symbol style',
    );
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Vessel types',
      'Generic ship',
    ]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    buttons[1].click();
    expect(onModeChange).toHaveBeenCalledWith('generic');

    const retention = target.querySelector<HTMLSelectElement>('select');
    expect(retention?.value).toBe('60');
    if (!retention) throw new Error('Expected the AIS retention control');
    retention.value = '360';
    retention.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onRetentionMinutesChange).toHaveBeenCalledWith(360);
  });
});

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
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(AisDisplaySettings, {
        target,
        props: { mode: 'type-specific', onModeChange },
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
  });
});

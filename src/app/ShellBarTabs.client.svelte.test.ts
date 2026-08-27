import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ShellBarTabs from './ShellBarTabs.svelte';

describe('ShellBarTabs interactions', () => {
  it('toggles the bottom bar', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onToggleBottom = vi.fn();
    const onToggleInstruments = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(ShellBarTabs, {
        target,
        props: {
          bottomBarVisible: true,
          instrumentsOpen: false,
          onToggleBottom,
          onToggleInstruments,
        },
      });
    });

    target.querySelector<HTMLButtonElement>('[aria-label="Hide bottom bar"]')?.click();
    target.querySelector<HTMLButtonElement>('[aria-label="Open instrument dock"]')?.click();
    expect(onToggleBottom).toHaveBeenCalledOnce();
    expect(onToggleInstruments).toHaveBeenCalledOnce();

    await unmount(component);
    target.remove();
  });
});

import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ShellBarTabs from './ShellBarTabs.svelte';

describe('ShellBarTabs interactions', () => {
  it('toggles the top and bottom bars independently', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onToggleTop = vi.fn();
    const onToggleBottom = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(ShellBarTabs, {
        target,
        props: {
          topBarVisible: true,
          bottomBarVisible: true,
          onToggleTop,
          onToggleBottom,
        },
      });
    });

    target.querySelector<HTMLButtonElement>('[aria-label="Hide top bar"]')?.click();
    expect(onToggleTop).toHaveBeenCalledOnce();
    expect(onToggleBottom).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('[aria-label="Hide bottom bar"]')?.click();
    expect(onToggleBottom).toHaveBeenCalledOnce();

    await unmount(component);
    target.remove();
  });
});

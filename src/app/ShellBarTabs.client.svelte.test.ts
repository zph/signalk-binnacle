import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ShellBarTabs from './ShellBarTabs.svelte';

describe('ShellBarTabs interactions', () => {
  it('toggles the bottom bar', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onToggleBottom = vi.fn();
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(ShellBarTabs, {
        target,
        props: {
          bottomBarVisible: true,
          onToggleBottom,
        },
      });
    });

    target.querySelector<HTMLButtonElement>('[aria-label="Hide bottom bar"]')?.click();
    expect(onToggleBottom).toHaveBeenCalledOnce();

    await unmount(component);
    target.remove();
  });
});

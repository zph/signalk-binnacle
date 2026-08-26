import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ShellBarTabs from './ShellBarTabs.svelte';

describe('ShellBarTabs', () => {
  it('labels each independent bar action and exposes its controlled region', () => {
    const body = render(ShellBarTabs, {
      props: {
        topBarVisible: true,
        bottomBarVisible: false,
        onToggleTop: vi.fn(),
        onToggleBottom: vi.fn(),
      },
    }).body;

    expect(body).toContain('aria-label="Hide top bar"');
    expect(body).toContain('aria-controls="top-toolbar"');
    expect(body).toContain('aria-expanded="true"');
    expect(body).toContain('aria-label="Show bottom bar"');
    expect(body).toContain('aria-controls="bottom-toolbar"');
    expect(body).toContain('aria-expanded="false"');
  });
});

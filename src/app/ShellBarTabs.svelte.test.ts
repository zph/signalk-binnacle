import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ShellBarTabs from './ShellBarTabs.svelte';

describe('ShellBarTabs', () => {
  it('labels the attached bottom-bar action and exposes its controlled region', () => {
    const body = render(ShellBarTabs, {
      props: {
        bottomBarVisible: false,
        instrumentsOpen: true,
        instrumentsFullScreen: false,
        onToggleBottom: vi.fn(),
        onToggleInstruments: vi.fn(),
      },
    }).body;

    expect(body).toContain('aria-label="Show bottom bar"');
    expect(body).toContain('aria-controls="bottom-toolbar"');
    expect(body).toContain('aria-expanded="false"');
    expect(body).toContain('aria-label="Close instrument dock"');
    expect(body).toContain('aria-controls="instrument-dock"');
  });
});

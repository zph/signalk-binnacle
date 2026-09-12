import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import DisplayPanel from './DisplayPanel.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

const controller = {
  autoTheme: false,
  setAutoTheme: vi.fn(),
  autoThemeSuspended: false,
  sunMode: false,
  setSunMode: vi.fn(),
} satisfies DisplaySettingsController;

describe('DisplayPanel', () => {
  it('renders a directly reachable panel with the two selected settings', () => {
    const body = render(DisplayPanel, {
      props: { controller, onClose: vi.fn(), onBack: vi.fn() },
    }).body;
    expect(body).toContain('Display');
    expect(body).toContain('Close display panel');
    expect(body).toContain('follow daylight automatically');
    expect(body).toContain('Automatic theme');
    expect(body).toContain('Bright sun chart');
  });
});

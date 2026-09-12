import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import DisplaySettings from './DisplaySettings.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

function fakeController(
  overrides: Partial<DisplaySettingsController> = {},
): DisplaySettingsController {
  return {
    autoTheme: false,
    setAutoTheme: vi.fn(),
    autoThemeSuspended: false,
    sunMode: false,
    setSunMode: vi.fn(),
    ...overrides,
  };
}

function renderSettings(overrides: Partial<DisplaySettingsController> = {}): string {
  return render(DisplaySettings, { props: { controller: fakeController(overrides) } }).body;
}

describe('DisplaySettings', () => {
  it('renders only the selected automatic-theme and bright-sun controls', () => {
    const body = renderSettings();
    expect(body).toContain('Automatic theme');
    expect(body).toContain('Bright sun chart');
    expect(body).not.toContain('Screen dim');
    expect(body).not.toContain('Text size');
  });

  it('explains source precedence, daytime scope, and a manual hold', () => {
    const body = renderSettings({ autoTheme: true, autoThemeSuspended: true, sunMode: true });
    expect(body).toContain("Signal K's day or night mode");
    expect(body).toContain('local sun position');
    expect(body).toContain('Paused for your theme choice');
    expect(body).toContain('applies only to the day theme');
  });
});

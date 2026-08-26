import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ChartContextMenu from './ChartContextMenu.svelte';

describe('ChartContextMenu', () => {
  it('offers the personal-note action when the host wires it', () => {
    const body = render(ChartContextMenu, {
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onAddNote: vi.fn(),
        onClose: vi.fn(),
      },
    }).body;
    expect(body).toContain('Add note here');
  });

  it('always exposes a consistently positioned full-screen action', () => {
    const enabled = render(ChartContextMenu, {
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onFullScreen: vi.fn(),
        onLockInterface: vi.fn(),
        onClose: vi.fn(),
      },
    }).body;
    expect(enabled).toContain('Full screen');
    expect(enabled).not.toContain('disabled');

    const unsupported = render(ChartContextMenu, {
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onLockInterface: vi.fn(),
        onClose: vi.fn(),
      },
    }).body;
    expect(unsupported).toContain('Full screen');
    expect(unsupported).toContain('disabled');
  });

  it('offers the interface lock when the host wires it', () => {
    const body = render(ChartContextMenu, {
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onLockInterface: vi.fn(),
        onClose: vi.fn(),
      },
    }).body;

    expect(body).toContain('Lock Binnacle');
  });
});

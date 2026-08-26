import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayTick } from './overlay-tick';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createOverlayTick', () => {
  it('does not reinstall tick wiring after the owner is destroyed', () => {
    vi.useFakeTimers();
    const handlers = new Map<string, Set<() => void>>();
    const map = {
      on: vi.fn((type: string, handler: () => void) => {
        const current = handlers.get(type) ?? new Set();
        current.add(handler);
        handlers.set(type, current);
      }),
      off: vi.fn((type: string, handler: () => void) => handlers.get(type)?.delete(handler)),
    };
    const documentTarget = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', globalThis);
    let destroyed = false;
    const overlay = { sync: vi.fn() };
    const tick = createOverlayTick(map as never, {} as never, () => destroyed);

    tick.runTick([overlay]);
    expect(handlers.get('move')?.size).toBe(1);
    destroyed = true;
    tick.stopTick();
    map.on.mockClear();
    overlay.sync.mockClear();

    tick.runTick([overlay]);
    vi.advanceTimersByTime(500);

    expect(map.on).not.toHaveBeenCalled();
    expect(handlers.get('move')?.size ?? 0).toBe(0);
    expect(overlay.sync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not synchronize store overlays for an unrelated map render', () => {
    vi.useFakeTimers();
    const handlers = new Map<string, Set<() => void>>();
    const map = {
      on: vi.fn((type: string, handler: () => void) => {
        const current = handlers.get(type) ?? new Set();
        current.add(handler);
        handlers.set(type, current);
      }),
      off: vi.fn((type: string, handler: () => void) => handlers.get(type)?.delete(handler)),
    };
    const documentTarget = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', globalThis);
    const overlay = { sync: vi.fn() };
    const tick = createOverlayTick(map as never, {} as never, () => false);

    tick.runTick([overlay]);
    overlay.sync.mockClear();
    for (let frame = 0; frame < 10_000; frame += 1) {
      for (const handler of handlers.get('render') ?? []) handler();
    }
    expect(overlay.sync).not.toHaveBeenCalled();
    expect(map.on).not.toHaveBeenCalledWith('render', expect.any(Function));

    for (const handler of handlers.get('move') ?? []) handler();
    expect(overlay.sync).toHaveBeenCalledTimes(1);
    tick.stopTick();
  });
});

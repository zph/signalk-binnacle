import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_INSTRUMENT_DOCK_WIDTH_PX, maxInstrumentDockWidthForViewport } from './dock-width';
import InstrumentDockResize from './InstrumentDockResize.svelte';

const VIEWPORT = 1600;

// A real window's innerWidth is read-only; an own property shadow gives every test in this file a
// deterministic wide viewport. Chromium's instance accessor is replaced for the file's lifetime.
Object.defineProperty(window, 'innerWidth', { value: VIEWPORT, configurable: true });

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

function mountHandle(width: number) {
  const onResize = vi.fn();
  const onCommit = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(InstrumentDockResize, {
      target: host,
      props: { width, onResize, onCommit },
    });
  });
  mounted.push(() => {
    void unmount(component);
    host.remove();
  });
  const handle = host.querySelector<HTMLElement>('[role="slider"]');
  if (!handle) throw new Error('Missing resize handle');
  return { handle, onResize, onCommit };
}

function pressKey(handle: HTMLElement, key: string): void {
  handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('InstrumentDockResize keyboard range', () => {
  it('spans the viewport with End, clamped to leave a chart edge', () => {
    const { handle, onResize, onCommit } = mountHandle(352);

    const expectedMax = maxInstrumentDockWidthForViewport(VIEWPORT);
    expect(expectedMax).toBe(VIEWPORT - 48);
    expect(Number(handle.getAttribute('aria-valuemax'))).toBe(expectedMax);
    expect(expectedMax).toBeGreaterThan(768);

    pressKey(handle, 'End');
    expect(onResize).toHaveBeenLastCalledWith(expectedMax);
    expect(onCommit).toHaveBeenCalledWith(expectedMax);
  });

  it('returns to the minimum on Home and steps 16 px per arrow', () => {
    const { handle, onResize } = mountHandle(800);

    pressKey(handle, 'Home');
    expect(onResize).toHaveBeenLastCalledWith(MIN_INSTRUMENT_DOCK_WIDTH_PX);

    pressKey(handle, 'ArrowLeft');
    expect(onResize).toHaveBeenLastCalledWith(816);
    pressKey(handle, 'ArrowRight');
    expect(onResize).toHaveBeenLastCalledWith(784);
  });
});

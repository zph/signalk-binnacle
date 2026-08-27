import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReorder, type ReorderItem } from './reorder.svelte';

// The animation-frame pair is not available in the Node test environment; stub both so the refocus
// scheduling inside handleKeydown does not throw, recording the handles rather than running the
// callback (focus behavior is not asserted here).
const scheduled: number[] = [];
const cancelled: number[] = [];
let nextFrame = 0;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => {
    nextFrame += 1;
    scheduled.push(nextFrame);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    cancelled.push(handle);
  });
});

beforeEach(() => {
  scheduled.length = 0;
  cancelled.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeItems(count: number): ReorderItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, title: `Item ${i}` }));
}

function fakeKey(key: string): KeyboardEvent {
  return { key, preventDefault: () => {} } as unknown as KeyboardEvent;
}

describe('createReorder', () => {
  it('ArrowDown commits id to from + 1 and sets a non-empty announcement', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));

    expect(committed).toEqual([{ id: 'item-0', slot: 1 }]);
    expect(r.reorderAnnouncement).not.toBe('');
  });

  it('ArrowUp at index 0 does not commit', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowUp'));

    expect(committed).toHaveLength(0);
  });

  it('clampSlot returning same slot as from suppresses commit', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      // Always clamp back to index 0, so ArrowDown on item-0 resolves to 0 == from and no-ops.
      clampSlot: (_items, _id, _slot) => 0,
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));

    expect(committed).toHaveLength(0);
  });

  it('cancels the pending refocus frame when a second move supersedes it', () => {
    const items = makeItems(3);
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: () => {},
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));
    r.handleKeydown('item-1', fakeKey('ArrowDown'));

    expect(scheduled).toHaveLength(2);
    expect(cancelled).toEqual([scheduled[0]]);
  });

  it('reads the updated owner order for a rapid reverse move', () => {
    let items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => {
        committed.push({ id, slot });
        const remaining = items.filter((item) => item.id !== id);
        const moved = items.find((item) => item.id === id);
        if (moved) remaining.splice(slot, 0, moved);
        items = remaining;
      },
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-1', fakeKey('ArrowUp'));
    r.handleKeydown('item-1', fakeKey('ArrowDown'));

    expect(committed).toEqual([
      { id: 'item-1', slot: 0 },
      { id: 'item-1', slot: 1 },
    ]);
    expect(items.map((item) => item.id)).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('commits the insertion slot selected by a pointer drag', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const listeners = new Map<string, EventListener>();
    const handle = {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.set(type, listener);
      },
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    } as unknown as HTMLElement;
    const rows = [
      {
        getAttribute: () => 'item-0',
        getBoundingClientRect: () => ({ top: 0, height: 20 }),
      },
      {
        getAttribute: () => 'item-1',
        getBoundingClientRect: () => ({ top: 20, height: 20 }),
      },
      {
        getAttribute: () => 'item-2',
        getBoundingClientRect: () => ({ top: 40, height: 20 }),
      },
    ] as unknown as HTMLElement[];
    const list = {
      addEventListener: vi.fn(),
      querySelectorAll: () => rows,
    } as unknown as HTMLElement;
    const r = createReorder({
      getItems: () => items,
      getListEl: () => list,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });
    const preventDefault = vi.fn();

    r.handlePointerDown('item-1', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 7,
      currentTarget: handle,
      preventDefault,
    } as unknown as PointerEvent);
    listeners.get('pointermove')?.({ clientY: 5 } as unknown as Event);
    listeners.get('pointerup')?.({} as Event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(committed).toEqual([{ id: 'item-1', slot: 0 }]);
  });

  it('uses horizontal position to select a column in grid layout', () => {
    const items = makeItems(4);
    const committed: Array<{ id: string; slot: number }> = [];
    const listeners = new Map<string, EventListener>();
    const handle = {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.set(type, listener);
      },
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    } as unknown as HTMLElement;
    const rect = (left: number, top: number) => ({
      left,
      top,
      width: 90,
      height: 80,
      right: left + 90,
      bottom: top + 80,
    });
    // item-0 is the dragged tile. The remaining DOM positions retain the empty first grid cell.
    const rows = [
      { getAttribute: () => 'item-0', getBoundingClientRect: () => rect(0, 0) },
      { getAttribute: () => 'item-1', getBoundingClientRect: () => rect(100, 0) },
      { getAttribute: () => 'item-2', getBoundingClientRect: () => rect(0, 100) },
      { getAttribute: () => 'item-3', getBoundingClientRect: () => rect(100, 100) },
    ] as unknown as HTMLElement[];
    const list = {
      addEventListener: vi.fn(),
      querySelectorAll: () => rows,
    } as unknown as HTMLElement;
    const r = createReorder({
      getItems: () => items,
      getListEl: () => list,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
      layout: 'grid',
    });

    r.handlePointerDown('item-0', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 8,
      currentTarget: handle,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);
    listeners.get('pointermove')?.({ clientX: 120, clientY: 110 } as unknown as Event);
    listeners.get('pointerup')?.({} as Event);

    expect(committed).toEqual([{ id: 'item-0', slot: 2 }]);
  });
});

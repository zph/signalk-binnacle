import { flushSync, untrack } from 'svelte';
import { describe, expect, it } from 'vitest';
import {
  type InstrumentLayoutSet,
  type InstrumentLayoutSnapshot,
  instrumentLayoutSetCodec,
  isInstrumentLayoutSet,
  PersistedValue,
} from '$shared/settings';
import { createInstrumentLayoutsController } from './instrument-layouts-controller.svelte';

const snapshot = (): InstrumentLayoutSnapshot => ({
  tiles: ['depth'],
  boxes: [{ id: 'depth', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
  sizes: { depth: 'tall' },
  history: { 'twa-history': 60 },
  opacity: 0.8,
  radarRange: 6,
  noGo: 1.2,
  arcMargin: 0.1,
});

function fixture() {
  const store = new PersistedValue<InstrumentLayoutSet>(
    'test-layouts',
    { active: '', layouts: [] },
    undefined,
    instrumentLayoutSetCodec,
  );
  let live = snapshot();
  const controller = createInstrumentLayoutsController({
    store,
    capture: () => live,
    apply: (next) => {
      live = next;
    },
  });
  controller.observe();
  return {
    store,
    controller,
    read: () => live,
    edit: (next: InstrumentLayoutSnapshot) => {
      live = next;
    },
  };
}

describe('instrument layout sets', () => {
  it('preserves the existing layout and supplies valid bounded starter layouts', () => {
    const f = fixture();
    expect(f.controller.active?.snapshot).toEqual(snapshot());
    expect(f.controller.layouts.map((l) => l.name)).toEqual([
      'My instruments',
      'Marina entry',
      'Leisure sailing',
      'Sailing performance',
    ]);
    expect(isInstrumentLayoutSet(f.store.snapshot())).toBe(true);
  });

  it('saves outgoing edits synchronously, cycles both ways, and restores tile settings', () => {
    const f = fixture();
    f.edit({ ...snapshot(), opacity: 0.4 });
    f.controller.cycle(-1);
    expect(f.controller.active?.id).toBe('performance');
    f.controller.cycle(1);
    expect(f.read().opacity).toBe(0.4);
    expect(f.read().boxes).toEqual(snapshot().boxes);
    expect(f.read().history).toEqual(snapshot().history);
  });

  it('duplicates independently, rejects empty names, and caps the collection', () => {
    const f = fixture();
    f.controller.duplicate('Passage');
    const duplicateId = f.controller.active?.id;
    f.edit({ ...snapshot(), tiles: ['stw'] });
    f.controller.rename('Offshore');
    f.controller.rename('  ');
    expect(f.controller.active?.name).toBe('Offshore');
    f.controller.select('custom');
    expect(f.read().tiles).toEqual(['depth']);
    f.controller.select(duplicateId ?? '');
    expect(f.read().tiles).toEqual(['stw']);
    for (let i = 0; i < 30; i++) f.controller.duplicate(`Layout ${i}`);
    expect(f.controller.layouts).toHaveLength(20);
  });

  it('restores presets and leaves custom arrangements intact', () => {
    const f = fixture();
    f.controller.restore();
    expect(f.read()).toEqual(snapshot());
    f.controller.select('marina');
    f.edit({ ...f.read(), boxes: [] });
    f.controller.observe();
    f.controller.restore();
    expect(f.read().boxes).toHaveLength(4);
  });

  it('applies a server-loaded collection without overwriting it with the outgoing arrangement', () => {
    const f = fixture();
    const incoming = f.store.snapshot();
    incoming.active = 'leisure';
    f.store.set(incoming);
    f.controller.observe();
    expect(f.read().tiles).toContain('wind-rose');
    expect(f.controller.active?.id).toBe('leisure');
  });

  it('autosaves reactive edits without an effect loop and reloads the selected layout', () => {
    const cleanup = $effect.root(() => {
      const store = new PersistedValue<InstrumentLayoutSet>(
        'reactive-layouts',
        { active: '', layouts: [] },
        undefined,
        instrumentLayoutSetCodec,
      );
      let live = $state(snapshot());
      const c = createInstrumentLayoutsController({
        store,
        capture: () => ({ ...live }),
        apply: (next) => {
          live = next;
        },
      });
      $effect(() => c.observe());
      flushSync();
      live = { ...untrack(() => live), opacity: 0.3 };
      flushSync();
      expect(c.active?.snapshot.opacity).toBe(0.3);
      c.select('performance');
      flushSync();
      expect(c.active?.snapshot.tiles).toContain('polar-performance');
      const reloaded = createInstrumentLayoutsController({
        store,
        capture: snapshot,
        apply: (next) => {
          live = next;
        },
      });
      reloaded.observe();
      expect(untrack(() => live.tiles)).toContain('polar-performance');
    });
    cleanup();
  });

  it('rejects malformed and oversized provider layouts', () => {
    const f = fixture();
    const valid = f.store.snapshot();
    expect(isInstrumentLayoutSet({ ...valid, active: 'missing' })).toBe(false);
    expect(isInstrumentLayoutSet({ ...valid, layouts: [valid.layouts[0], valid.layouts[0]] })).toBe(
      false,
    );
    expect(
      isInstrumentLayoutSet({
        active: 'bad',
        layouts: [
          {
            id: 'bad',
            name: 'Bad',
            snapshot: { ...snapshot(), boxes: [{ id: 'depth', x: 1, y: 0, width: 1, height: 1 }] },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isInstrumentLayoutSet({
        active: 'bad',
        layouts: [{ id: 'bad', name: 'Bad', snapshot: { ...snapshot(), radarRange: NaN } }],
      }),
    ).toBe(false);
  });
});

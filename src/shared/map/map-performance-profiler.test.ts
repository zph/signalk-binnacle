import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMapPerformanceProfiler } from './map-performance-profiler';

function environment(search: string) {
  const dataset: DOMStringMap = {};
  const intervals = new Map<number, () => void>();
  let nextInterval = 1;
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('window', {
    location: { search },
    setInterval: (callback: () => void) => {
      const id = nextInterval;
      nextInterval += 1;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => intervals.delete(id),
  });
  return { dataset, intervals };
}

function fakeMap() {
  const handlers = new Map<string, Set<() => void>>();
  const source = { setData: vi.fn((_data: unknown) => {}) };
  return {
    source,
    getSource: vi.fn((_id: string) => source),
    setFeatureState: vi.fn(),
    setFilter: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    triggerRepaint: vi.fn(),
    on: vi.fn((type: string, handler: () => void) => {
      const current = handlers.get(type) ?? new Set();
      current.add(handler);
      handlers.set(type, current);
    }),
    off: vi.fn((type: string, handler: () => void) => handlers.get(type)?.delete(handler)),
    emit(type: string) {
      for (const handler of handlers.get(type) ?? []) handler();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('map performance profiler', () => {
  it('stays absent unless the explicit diagnostic query flag is set', () => {
    environment('');

    expect(createMapPerformanceProfiler(fakeMap() as never)).toBeUndefined();
  });

  it('attributes mutation counts without retaining map payloads', () => {
    const { dataset, intervals } = environment('?profileMap=1');
    const map = fakeMap();
    const originalSetData = map.source.setData;
    const profiler = createMapPerformanceProfiler(map as never);

    profiler?.runOverlay('ais', () => {
      map.getSource('synthetic-source').setData({ privatePayload: 'must-not-be-profiled' });
      map.setPaintProperty('synthetic-layer', 'circle-color', 'red');
    });
    map.emit('render');
    for (const publish of intervals.values()) publish();

    expect(profiler?.snapshot()).toMatchObject({
      renderCount: 1,
      overlays: [
        {
          id: 'ais',
          syncCount: 1,
          mutations: { 'set-data': 1, 'set-paint-property': 1 },
        },
      ],
    });
    expect(dataset.binnacleMapPerformance).not.toContain('privatePayload');
    expect(dataset.binnacleMapPerformance).not.toContain('synthetic-source');

    profiler?.destroy();
    expect(map.source.setData).toBe(originalSetData);
    expect(intervals.size).toBe(0);
  });
});

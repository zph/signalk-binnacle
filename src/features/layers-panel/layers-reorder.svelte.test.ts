import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LayerListItem } from '$shared/map';
import { createLayerSubsetReorder } from './layers-reorder.svelte';
import type { LayersView } from './layers-view.svelte';

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function item(id: string, category: string): LayerListItem {
  return {
    id,
    title: id,
    visible: true,
    opacity: 1,
    supportsOpacity: true,
    pinned: false,
    band: 'bathymetry',
    category,
    available: true,
  };
}

function key(keyName: string): KeyboardEvent {
  return { key: keyName, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe('createLayerSubsetReorder', () => {
  it('commits a chart-only position through the view subset boundary', () => {
    const movable = [
      item('traffic', 'live'),
      item('chart-a', 'charts'),
      item('reference', 'reference'),
      item('chart-b', 'charts'),
      item('route', 'mine'),
    ];
    const charts = movable.filter((entry) => entry.category === 'charts');
    const reorderSubset = vi.fn();
    const controller = createLayerSubsetReorder(
      () => ({ reorderSubset }) as unknown as LayersView,
      () => charts,
      () => undefined,
      'Chart',
    );

    controller.handleKeydown('chart-a', key('ArrowDown'));

    expect(reorderSubset).toHaveBeenCalledWith('chart-a', ['chart-a', 'chart-b'], 1);
    expect(controller.reorderAnnouncement).toBe('Moved chart-a to position 2 of 2.');
  });
});

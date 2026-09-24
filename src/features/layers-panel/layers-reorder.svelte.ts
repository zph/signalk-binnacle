import type { LayerListItem } from '$shared/map';
import { createReorder, type Reorder } from '$shared/ui';
import { clampReorderSlot } from './layer-category';
import type { LayersView } from './layers-view.svelte';

export type LayerReorder = Reorder;

export function createLayerReorder(
  getView: () => LayersView,
  getMovable: () => LayerListItem[],
  getListEl: () => HTMLUListElement | undefined,
): LayerReorder {
  const view = getView();
  return createReorder({
    getItems: getMovable,
    getListEl,
    commit: (id, slot) => view.reorder(id, slot),
    // The clamp reads category off LayerListItem, so it receives the original items by closure.
    clampSlot: (_items, id, slot) => clampReorderSlot(getMovable(), id, slot),
    rowAttribute: 'data-layer-row',
    handleSelector: '.handle',
    itemNoun: 'Layer',
  });
}

// A filtered view, such as Layers and Overlays, addresses positions inside only the rows it
// renders.
// Translate that subset insertion slot back into the full movable list before persisting it, so a
// pointer drop cannot jump across non-rendered rows and the handle positions remain local to the
// visible list.
export function createLayerSubsetReorder(
  getView: () => LayersView,
  getSubset: () => LayerListItem[],
  getListEl: () => HTMLUListElement | undefined,
  itemNoun: string,
): LayerReorder {
  const view = getView();
  return createReorder({
    getItems: getSubset,
    getListEl,
    commit: (id, subsetSlot) =>
      view.reorderSubset(
        id,
        getSubset().map((item) => item.id),
        subsetSlot,
      ),
    rowAttribute: 'data-layer-row',
    handleSelector: '.handle',
    itemNoun,
  });
}

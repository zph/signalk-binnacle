import type { LayerListItem, LayerManager } from '$shared/map';
import { clampReorderSlot, layerCategory } from './layer-category';

export class LayersView {
  items = $state<LayerListItem[]>([]);

  #manager: LayerManager;

  constructor(manager: LayerManager) {
    this.#manager = manager;
  }

  // Never read `this.items` here: refresh() runs inside a $effect (the layers-availability refresh in
  // App), and reading the freshly written `items` signal in that effect loops (effect_update_depth_exceeded).
  refresh(): void {
    this.items = this.#manager.layers();
  }

  // A toggle can flip several rows at once (the weather fills are mutually exclusive), so rebuild
  // the list from the manager rather than mutating one item. A discrete toggle is not a per-pixel
  // stream, so a full refresh is fine here (unlike the opacity slider below).
  toggle(id: string, visible: boolean): void {
    this.#manager.toggle(id, visible);
    this.refresh();
  }

  setOpacity(id: string, opacity: number, persist = true): void {
    this.#manager.setOpacity(id, opacity, persist);
    // Mutate the item inside `this.items` (the reactive $state array) in place, so the displayed
    // percentage updates without rebuilding the whole list on every slider tick. `find` returns the
    // reactive element; a plain-Map cache of raw objects would bypass reactivity and freeze the readout.
    // Reading this.items here is safe: setOpacity runs from the slider event, not the availability effect.
    const item = this.items.find((i) => i.id === id);
    if (item) item.opacity = opacity;
  }

  setCellSizeScale(id: string, scale: number, persist = true): void {
    this.#manager.setCellSizeScale(id, scale, persist);
    const item = this.items.find((candidate) => candidate.id === id);
    if (item?.cellSizeControl) {
      const { minimum, maximum, step } = item.cellSizeControl;
      const clamped = Math.max(minimum, Math.min(maximum, scale));
      item.cellSizeScale = Math.min(
        maximum,
        minimum + Math.round((clamped - minimum) / step) * step,
      );
    }
  }

  // Move a layer to a new index in the top-to-bottom display order, then rebuild the list in
  // the new order. A reorder is a discrete drop, not a per-pixel stream, so a full refresh is
  // fine here (unlike the in-place opacity write above, which mutates one item). Full-list targets
  // are clamped here so they cannot move a row outside its category bucket. Filtered lists use the
  // separately guarded reorderSubset path below.
  reorder(id: string, toIndex: number): void {
    const movable = this.items.filter((item) => !item.pinned && !item.parent);
    this.#manager.reorder(id, clampReorderSlot(movable, id, toIndex));
    this.refresh();
  }

  // Reorder inside a filtered list, such as the Charts tab, whose visible positions do not map
  // directly onto the full overlay stack. The supplied ids are narrowed to the moved row's own
  // category, then the manager atomically permutes only those stack slots. That preserves hidden
  // non-chart rows even when a restored legacy order interleaves categories.
  reorderSubset(id: string, subsetIds: string[], toIndex: number): void {
    const movable = this.items.filter((item) => !item.pinned && !item.parent);
    const moved = movable.find((item) => item.id === id);
    if (!moved) return;
    const category = layerCategory(moved).id;
    const allowed = new Set(subsetIds);
    const subset = movable.filter(
      (item) => allowed.has(item.id) && layerCategory(item).id === category,
    );
    if (!subset.some((item) => item.id === id)) return;

    this.#manager.reorderSubset(
      id,
      subset.map((item) => item.id),
      Math.max(0, Math.min(toIndex, subset.length - 1)),
    );
    this.refresh();
  }
}

export interface ReorderItem {
  id: string;
  title: string;
}

export interface ReorderOptions {
  getItems: () => ReorderItem[];
  getListEl: () => HTMLElement | undefined;
  commit: (id: string, slot: number) => void;
  // Optional slot clamp (the layers category constraint); identity when absent.
  clampSlot?: (items: ReorderItem[], id: string, slot: number) => number;
  // DOM contract, parameterized: the row data attribute and the focusable handle selector.
  rowAttribute: string; // e.g. 'data-layer-row' or 'data-tile-row'
  handleSelector: string; // e.g. '.handle'
  itemNoun: string; // 'Layer' or 'Tile', for the polite announcement fallback
  // Lists use vertical midpoint targeting. A tile dashboard can opt into visual grid targeting so
  // horizontal pointer position selects the intended column as well as the row.
  layout?: 'vertical' | 'grid';
}

export interface Reorder {
  // The id being dragged, so a row can render its dragging state.
  readonly dragId: string | null;
  // Announced politely after a keyboard reorder, so a screen-reader user hears the new z-order.
  readonly reorderAnnouncement: string;
  // Which edge, if any, a row should draw the drop indicator on.
  indicatorFor(id: string): { before: boolean; after: boolean };
  handlePointerDown(id: string, event: PointerEvent): void;
  handleKeydown(id: string, event: KeyboardEvent): void;
}

// The imperative pointer-and-keyboard drag-reorder controller. It owns the drag state and the
// window listeners, addressing rows by their index in the movable list, and commits a drop through
// options.commit. getItems and getListEl are getters so the controller always reads the caller's
// current list and list element rather than capturing stale refs, and so the movable list has a
// single owner that cannot drift from the controller's copy. Construct it during a component's
// initialization: it owns an effect that cancels a queued refocus frame when that component tears down.
export function createReorder(options: ReorderOptions): Reorder {
  // The movable rows: read through the caller's getter so there is one owner of the list and the
  // controller cannot drift from it.
  const movable = $derived(options.getItems());

  // The non-pinned id being dragged, and the insertion slot it would land in. The slot is an
  // index in the movable list with the dragged row removed, matching commit's contract.
  let dragId = $state<string | null>(null);
  let dropSlot = $state<number | null>(null);

  // The movable rows minus the one being dragged, computed once per drag frame rather than
  // re-filtered for every row inside indicatorFor.
  const remaining = $derived(
    dragId === null ? movable : movable.filter((item) => item.id !== dragId),
  );

  // Announced politely after a keyboard reorder, so a screen-reader user hears the new z-order rather
  // than only the refocused handle re-reading its label.
  let reorderAnnouncement = $state('');

  const clamp = options.clampSlot ?? ((_items: ReorderItem[], _id: string, s: number) => s);

  // The pending post-commit refocus frame. A quick second keyboard move supersedes the first, and
  // the owner's teardown cancels whatever is still queued, so no frame runs against a torn-down list.
  let refocusFrame: number | null = null;
  $effect(() => {
    return () => {
      if (refocusFrame !== null) cancelAnimationFrame(refocusFrame);
    };
  });

  // Translate an insertion slot (movable list, dragged row removed) into the id of the row it
  // renders against, plus which edge, so a row can draw the drop indicator.
  function indicatorFor(id: string): { before: boolean; after: boolean } {
    if (dragId === null || dropSlot === null || id === dragId) {
      return { before: false, after: false };
    }
    const rowIndex = remaining.findIndex((item) => item.id === id);
    if (rowIndex < 0) return { before: false, after: false };
    if (dropSlot === remaining.length) {
      return { before: false, after: rowIndex === remaining.length - 1 };
    }
    return { before: rowIndex === dropSlot, after: false };
  }

  function handlePointerDown(id: string, event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    const currentItems = options.getItems();
    dragId = id;
    dropSlot = currentItems.findIndex((item) => item.id === id);
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    // Resolve the list element once for this drag: both the initial measurement and the scroll
    // listener close over the same ref rather than reading the getter twice.
    const listEl = options.getListEl();

    // Measure each non-dragged row once at drag start, re-measuring only when the list scrolls
    // mid-drag, so a pointermove costs no layout read or reflow. Vertical lists need only the
    // midpoint; dashboard grids also need the horizontal bounds.
    const measureRects = (): DOMRect[] =>
      listEl
        ? [...listEl.querySelectorAll<HTMLElement>(`[${options.rowAttribute}]`)]
            .filter((el) => el.getAttribute(options.rowAttribute) !== id)
            .map((el) => el.getBoundingClientRect())
        : [];
    let rects = measureRects();

    const verticalSlot = (clientY: number): number => {
      let slot = rects.length;
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect && clientY < rect.top + rect.height / 2) {
          return i;
        }
      }
      return slot;
    };

    // Resolve the pointer against visual grid rows, then against tile centers in that row. DOM
    // order remains the committed order, while the horizontal coordinate disambiguates columns.
    const gridSlot = (clientX: number, clientY: number): number => {
      if (rects.length === 0) return 0;
      const positioned = rects.map((rect, slot) => ({ rect, slot }));
      const rows: Array<{
        top: number;
        bottom: number;
        entries: Array<{ rect: DOMRect; slot: number }>;
      }> = [];
      for (const entry of positioned) {
        const current = rows.at(-1);
        // CSS Grid aligns the tops of tiles in a visual row. A two-pixel tolerance absorbs browser
        // subpixel rounding without combining adjacent rows of different heights.
        if (!current || Math.abs(entry.rect.top - current.top) > 2) {
          rows.push({
            top: entry.rect.top,
            bottom: entry.rect.bottom,
            entries: [entry],
          });
        } else {
          current.bottom = Math.max(current.bottom, entry.rect.bottom);
          current.entries.push(entry);
        }
      }
      const first = rows[0];
      const last = rows.at(-1);
      if (!first || !last) return 0;
      if (clientY < first.top) return 0;
      if (clientY > last.bottom) return rects.length;

      let selected = last;
      for (let i = 0; i < rows.length - 1; i++) {
        const row = rows[i];
        const next = rows[i + 1];
        if (row && next && clientY < (row.bottom + next.top) / 2) {
          selected = row;
          break;
        }
      }
      for (const entry of selected.entries) {
        if (clientX < entry.rect.left + entry.rect.width / 2) return entry.slot;
      }
      return (selected.entries.at(-1)?.slot ?? -1) + 1;
    };

    // Clamp after either layout resolves its insertion slot. Category-constrained list callers
    // retain the same backstop, while an unconstrained tile grid uses the identity clamp.
    const slotFromPointer = (clientX: number, clientY: number): number => {
      const slot = options.layout === 'grid' ? gridSlot(clientX, clientY) : verticalSlot(clientY);
      return clamp(currentItems, id, slot);
    };

    // One AbortController tears down all the listeners on drop or cancel, so the teardown
    // lives in a single place rather than being repeated per handler.
    const drag = new AbortController();
    const { signal } = drag;
    listEl?.addEventListener(
      'scroll',
      () => {
        rects = measureRects();
      },
      { signal, passive: true },
    );
    const finish = (doCommit: boolean): void => {
      drag.abort();
      handle.releasePointerCapture(event.pointerId);
      if (doCommit && dragId !== null && dropSlot !== null) options.commit(dragId, dropSlot);
      dragId = null;
      dropSlot = null;
    };
    handle.addEventListener(
      'pointermove',
      (move) => {
        dropSlot = slotFromPointer(move.clientX, move.clientY);
      },
      { signal },
    );
    handle.addEventListener('pointerup', () => finish(true), { signal });
    handle.addEventListener('pointercancel', () => finish(false), { signal });
  }

  function handleKeydown(id: string, event: KeyboardEvent): void {
    // Read directly through the getter at the action boundary. A preceding keyboard move can update
    // the owner's list before Svelte has invalidated this controller's derived render state, and a
    // second rapid key press must use the new position rather than reversing from a stale index.
    const currentItems = options.getItems();
    const from = currentItems.findIndex((item) => item.id === id);
    if (from < 0) return;
    let to = from;
    if (event.key === 'ArrowUp') to = from - 1;
    else if (event.key === 'ArrowDown') to = from + 1;
    else return;
    event.preventDefault();
    if (to < 0 || to >= currentItems.length) return;
    // Hold the move inside the row's own category: a clamp back to the current slot means the row
    // is already at its bucket edge, so there is nothing to move or announce.
    to = clamp(currentItems, id, to);
    if (to === from) return;
    const title = currentItems[from]?.title ?? options.itemNoun;
    options.commit(id, to);
    reorderAnnouncement = `Moved ${title} to position ${to + 1} of ${currentItems.length}.`;
    // Keep focus on the moved handle as it follows the row to its new position.
    if (refocusFrame !== null) cancelAnimationFrame(refocusFrame);
    refocusFrame = requestAnimationFrame(() => {
      refocusFrame = null;
      const moved = options
        .getListEl()
        ?.querySelector<HTMLElement>(
          `[${options.rowAttribute}="${CSS.escape(id)}"] ${options.handleSelector}`,
        );
      moved?.focus();
    });
  }

  return {
    get dragId() {
      return dragId;
    },
    get reorderAnnouncement() {
      return reorderAnnouncement;
    },
    indicatorFor,
    handlePointerDown,
    handleKeydown,
  };
}

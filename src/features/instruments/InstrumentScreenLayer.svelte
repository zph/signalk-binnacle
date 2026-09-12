<script lang="ts">
import CircleHelp from '@lucide/svelte/icons/circle-help';
import Expand from '@lucide/svelte/icons/expand';
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import Plus from '@lucide/svelte/icons/plus';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import X from '@lucide/svelte/icons/x';
import { type Snippet, untrack } from 'svelte';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import {
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
} from '$shared/settings';
import type { HistoryProviders } from '$shared/signalk';
import { AnchoredMenu, registerDismiss, rovingFocus, type Theme } from '$shared/ui';
import { type AisRadarRangeNm, DEFAULT_AIS_RADAR_RANGE_NM } from './ais-radar-model';
import {
  clampFloatingBox,
  DEFAULT_FLOATING_HEIGHT,
  DEFAULT_FLOATING_WIDTH,
  type FloatingInstrumentBox,
  fitFloatingBoxToViewport,
  MAX_FLOATING_INSTRUMENTS,
  snapFloatingBoxToGrid,
  VERTICAL_HISTORY_FLOATING_HEIGHT,
  VERTICAL_HISTORY_FLOATING_WIDTH,
} from './floating-layout';
import InstrumentTile from './InstrumentTile.svelte';
import type { InstrumentAlias } from './instrument-alias';
import type { InstrumentsController } from './instruments-controller.svelte';
import { instrumentOptionLabels, staleAgeText, type TileDeps } from './tile-catalog';
import {
  createTileHistory,
  isSessionHistoryViz,
  isVerticalHistoryViz,
  maximumHistoryId,
} from './tile-history.svelte';
import { pollVerticalTileHistory } from './vertical-history-loader';
import {
  type InstrumentHistoryWindows,
  VERTICAL_HISTORY_BUFFER_CAPACITY,
  type VerticalHistoryWindowMinutes,
  verticalHistoryWindowMinutesFor,
} from './vertical-history-window';
import WindRoseSettings from './WindRoseSettings.svelte';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
  theme?: Theme;
  aisTargets?: AisTargets;
  collision?: CollisionAssessment;
  aisRadarRangeNm?: AisRadarRangeNm;
  onAisRadarRangeChange?: (rangeNm: AisRadarRangeNm) => void;
  companionBase?: string | null;
  chartToken?: string;
  mapInstrument?: Snippet<[boolean, string, () => void]>;
  windRoseNoGoAngleRad?: number;
  windRoseArcMarginRad?: number;
  onWindRoseNoGoAngleChange?: (angleRad: number) => void;
  onWindRoseArcMarginChange?: (angleRad: number) => void;
  onOpenTideSettings?: () => void;
  topBannerPresent?: boolean;
  // Called when the helm presses Done, so the shell can clear any edit-mode side effects.
  onDone?: () => void;
  // A long press on a locked chart instrument is the touch shortcut back into this same editor.
  onEdit?: () => void;
  overlayOpacity?: number;
  historyOrigin?: string;
  historyProviders?: HistoryProviders;
  historyWindows?: InstrumentHistoryWindows;
  onHistoryWindowChange?: (id: string, minutes: VerticalHistoryWindowMinutes) => void;
  instrumentAliases?: readonly InstrumentAlias[];
}

const {
  controller,
  deps,
  theme = 'day',
  aisTargets,
  collision,
  aisRadarRangeNm = DEFAULT_AIS_RADAR_RANGE_NM,
  onAisRadarRangeChange = () => {},
  companionBase,
  chartToken,
  mapInstrument,
  windRoseNoGoAngleRad = DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
  windRoseArcMarginRad = DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  onWindRoseNoGoAngleChange = () => {},
  onWindRoseArcMarginChange = () => {},
  onOpenTideSettings,
  onDone = () => {},
  onEdit = () => {},
  overlayOpacity = 1,
  historyOrigin,
  historyProviders,
  historyWindows = {},
  onHistoryWindowChange = () => {},
  instrumentAliases = [],
}: Props = $props();

const DRAG_MIME = 'text/x-binnacle-instrument';
const NUDGE_STEP = 0.02;
const DRAG_THRESHOLD_PX = 6;
const ALIGNMENT_TOLERANCE = 0.015;
const EDIT_LONG_PRESS_MS = 600;

const depthDef = $derived(controller.resolve('depth'));
const aisRadar = $derived(
  aisTargets && collision
    ? {
        vessel: deps.vessel,
        targets: aisTargets,
        collision,
        rangeNm: aisRadarRangeNm,
        onRangeChange: onAisRadarRangeChange,
        theme,
        companionBase,
        getToken: () => chartToken,
      }
    : undefined,
);

let layerEl = $state<HTMLElement | undefined>();
let layerSize = $state<{ width: number; height: number } | undefined>();
let layoutEpoch = $state(0);
let addMenuOpen = $state(false);
let helpOpen = $state(false);
let windRoseSettingsOpen = $state(false);
let addMenuTrigger = $state<HTMLElement | undefined>();
let helpTrigger = $state<HTMLElement | undefined>();
let expandedId = $state<string | undefined>();
// Physical shape is not encoded by normalized width/height alone: their pixel ratio changes when
// the viewport rotates. Remember it for this screen session so iPad and phone rotations can solve
// for new normalized dimensions without changing each instrument's screen coverage.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- resize bookkeeping triggers rendering
const floatingAspectRatios = new Map<string, number>();

// In-flight move or resize, so a drag renders its live box without writing storage per pointer
// event; the persisted box only changes when the pointer is released.
let dragBox = $state<FloatingInstrumentBox | undefined>();
let dropPreview = $state<FloatingInstrumentBox | undefined>();
let alignmentAnnouncement = $state('');
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressStart = $state<{ pointerId: number; x: number; y: number } | undefined>();

const floatingTiles = $derived(controller.floatingTiles);
const editing = $derived(controller.screenEditing);
const atFloatingCap = $derived(floatingTiles.length >= MAX_FLOATING_INSTRUMENTS);
const hasWindRose = $derived(floatingTiles.some(({ def }) => def.id === 'wind-rose'));

function observeLayer(node: HTMLElement): { destroy(): void } {
  const updateSize = (): void => {
    const { width, height } = node.getBoundingClientRect();
    const previous = layerSize;
    const reference = previous ?? { width, height };
    for (const { box } of floatingTiles) {
      if (!floatingAspectRatios.has(box.id) && reference.width > 0 && reference.height > 0) {
        floatingAspectRatios.set(
          box.id,
          (box.width * reference.width) / (box.height * reference.height),
        );
      }
    }
    layerSize = { width, height };
    // A rotation can leave a child tile with a canvas or measured readout sized for the old axis.
    // Re-key the frames after the chart bounds settle, so every instrument redraws to the final
    // portrait or landscape box instead of retaining a clipped top or bottom from the old shape.
    if (previous && (previous.width !== width || previous.height !== height)) layoutEpoch += 1;
  };
  updateSize();
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', updateSize);
    return { destroy: () => window.removeEventListener('resize', updateSize) };
  }
  const observer = new ResizeObserver(updateSize);
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}

function displayedBox(box: FloatingInstrumentBox): FloatingInstrumentBox {
  if (!layerSize) return box;
  let aspectRatio = floatingAspectRatios.get(box.id);
  if (!aspectRatio) {
    aspectRatio = (box.width * layerSize.width) / (box.height * layerSize.height);
    floatingAspectRatios.set(box.id, aspectRatio);
  }
  return fitFloatingBoxToViewport(box, layerSize, aspectRatio);
}

function commitFloatingBox(id: string, box: FloatingInstrumentBox): void {
  if (layerSize && box.width > 0 && box.height > 0) {
    floatingAspectRatios.set(id, (box.width * layerSize.width) / (box.height * layerSize.height));
  }
  controller.setFloatingBox(id, box);
}

type AlignmentGuide = { axis: 'x' | 'y'; value: number };
type AlignmentEdge = 'start' | 'center' | 'end';

function edgeValues(start: number, size: number): Array<{ edge: AlignmentEdge; value: number }> {
  return [
    { edge: 'start', value: start },
    { edge: 'center', value: start + size / 2 },
    { edge: 'end', value: start + size },
  ];
}

function edgeName(edge: AlignmentEdge): string {
  return edge === 'start' ? 'leading edge' : edge === 'end' ? 'trailing edge' : 'center';
}

function snapToAlignment(box: FloatingInstrumentBox): FloatingInstrumentBox {
  const others = floatingTiles
    .filter(({ def }) => def.id !== box.id)
    .map(({ box: other }) => displayedBox(other));
  let next = { ...box };
  let horizontal: string | undefined;
  let vertical: string | undefined;
  for (const other of others) {
    for (const own of edgeValues(next.x, next.width)) {
      const match = edgeValues(other.x, other.width).find(
        (candidate) => Math.abs(candidate.value - own.value) <= ALIGNMENT_TOLERANCE,
      );
      if (match) {
        next.x += match.value - own.value;
        horizontal = edgeName(match.edge);
        break;
      }
    }
    for (const own of edgeValues(next.y, next.height)) {
      const match = edgeValues(other.y, other.height).find(
        (candidate) => Math.abs(candidate.value - own.value) <= ALIGNMENT_TOLERANCE,
      );
      if (match) {
        next.y += match.value - own.value;
        vertical = edgeName(match.edge);
        break;
      }
    }
  }
  const message = [
    horizontal && `Aligned ${horizontal} horizontally`,
    vertical && `aligned ${vertical} vertically`,
  ]
    .filter(Boolean)
    .join(', ');
  if (message !== alignmentAnnouncement) alignmentAnnouncement = message;
  return clampFloatingBox(next);
}
const alignmentGuides = $derived.by<AlignmentGuide[]>(() => {
  if (!dragBox) return [];
  const guides: AlignmentGuide[] = [];
  const candidates = floatingTiles
    .filter(({ def }) => def.id !== dragBox?.id)
    .map(({ box }) => displayedBox(box));
  const horizontal = [dragBox.x, dragBox.x + dragBox.width / 2, dragBox.x + dragBox.width];
  const vertical = [dragBox.y, dragBox.y + dragBox.height / 2, dragBox.y + dragBox.height];
  for (const other of candidates) {
    const otherHorizontal = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherVertical = [other.y, other.y + other.height / 2, other.y + other.height];
    for (const value of horizontal) {
      if (otherHorizontal.some((candidate) => Math.abs(candidate - value) <= ALIGNMENT_TOLERANCE)) {
        guides.push({ axis: 'x', value });
      }
    }
    for (const value of vertical) {
      if (otherVertical.some((candidate) => Math.abs(candidate - value) <= ALIGNMENT_TOLERANCE)) {
        guides.push({ axis: 'y', value });
      }
    }
  }
  return [
    ...new Map(guides.map((guide) => [`${guide.axis}:${guide.value.toFixed(3)}`, guide])).values(),
  ];
});

const optionLabels = $derived(instrumentOptionLabels(controller.catalog));
const addable = $derived.by(() => {
  const placed = new Set(floatingTiles.map(({ def }) => def.id));
  return controller.catalog
    .filter((def) => !placed.has(def.id))
    .map((def) => ({ def, title: optionLabels.get(def.id) ?? controller.resolvedLabel(def) }));
});
const hasAddableEntry = $derived(addable.length > 0 || instrumentAliases.length > 0);

// Session tile history, sampled on the shared reactive clock exactly as the dock does.
const history = createTileHistory();
const verticalHistory = createTileHistory({ capacity: VERTICAL_HISTORY_BUFFER_CAPACITY });
$effect(() => {
  return pollVerticalTileHistory(
    verticalHistory,
    floatingTiles.map(({ def }) => def).filter((def) => isVerticalHistoryViz(def.viz)),
    historyOrigin && historyProviders
      ? { origin: historyOrigin, token: chartToken, providers: historyProviders }
      : undefined,
    historyWindows,
  );
});
$effect(() => {
  const now = deps.clock.now;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set, never rendered
  const liveIds = new Set<string>();
  for (const { def } of floatingTiles) {
    if (!isSessionHistoryViz(def.viz)) continue;
    liveIds.add(def.id);
    if (def.viz === 'vertical-speed') liveIds.add(maximumHistoryId(def.id));
    const reading = untrack(() => def.read(deps));
    const value = reading.state === 'live' ? reading.siValue : undefined;
    if (isVerticalHistoryViz(def.viz)) {
      verticalHistory.sampleBucket(def.id, value, now, def.viz === 'vertical-speed');
    } else history.sample(def.id, value, now);
  }
  history.prune(liveIds);
  verticalHistory.prune(liveIds);
});

// While editing, Escape peels the add instrument menu first (it registers later) and then exits
// edit mode through the shared dismiss stack.
$effect(() => {
  if (!editing) return;
  return registerDismiss(() => finishEditing());
});

function normalizedPoint(clientX: number, clientY: number): { x: number; y: number } | undefined {
  const bounds = layerEl?.getBoundingClientRect();
  if (!bounds || bounds.width === 0 || bounds.height === 0) return undefined;
  return {
    x: (clientX - bounds.left) / bounds.width,
    y: (clientY - bounds.top) / bounds.height,
  };
}

function beginDrag(
  kind: 'move' | 'resize',
  id: string,
  box: FloatingInstrumentBox,
  event: PointerEvent,
): void {
  if (event.button !== 0) return;
  const bounds = layerEl?.getBoundingClientRect();
  if (!bounds) return;
  dragBox = { ...box };
  const pointerId = event.pointerId;
  const startClientX = event.clientX;
  const startClientY = event.clientY;
  const startBox = { ...box };
  const target = event.currentTarget;
  if (target instanceof Element) target.setPointerCapture(pointerId);

  const handleMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = (moveEvent.clientX - startClientX) / bounds.width;
    const dy = (moveEvent.clientY - startClientY) / bounds.height;
    if (kind === 'move') {
      dragBox = snapToAlignment(
        snapFloatingBoxToGrid(
          clampFloatingBox({ ...startBox, x: startBox.x + dx, y: startBox.y + dy }),
          'move',
        ),
      );
    } else {
      dragBox = snapToAlignment(
        snapFloatingBoxToGrid(
          clampFloatingBox({
            ...startBox,
            width: startBox.width + dx,
            height: startBox.height + dy,
          }),
          'resize',
        ),
      );
    }
    moveEvent.preventDefault();
  };
  // A release commits the live box; a cancel (an incoming call, a stolen gesture) discards it
  // without writing anything.
  const commit = (): void => {
    teardown();
    const next = dragBox;
    dragBox = undefined;
    if (next) commitFloatingBox(id, next);
  };
  const discard = (): void => {
    teardown();
    dragBox = undefined;
  };
  function teardown(): void {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', commit);
    window.removeEventListener('pointercancel', discard);
  }
  window.addEventListener('pointermove', handleMove, { passive: false });
  window.addEventListener('pointerup', commit);
  window.addEventListener('pointercancel', discard);
  event.preventDefault();
}

// A drag starts only after a small movement threshold. A simple tap still reaches the instrument,
// while the entire tile body becomes a comfortable grab area in layout editing.
function beginBodyDrag(id: string, box: FloatingInstrumentBox, event: PointerEvent): void {
  if (event.button !== 0 || expandedId === id) return;
  const bounds = layerEl?.getBoundingClientRect();
  if (!bounds) return;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startBox = { ...box };
  let dragging = false;
  const target = event.currentTarget;
  if (target instanceof Element) target.setPointerCapture(pointerId);
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return;
    const dxPx = moveEvent.clientX - startX;
    const dyPx = moveEvent.clientY - startY;
    if (!dragging && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    dragBox = snapToAlignment(
      snapFloatingBoxToGrid(
        clampFloatingBox({
          ...startBox,
          x: startBox.x + dxPx / bounds.width,
          y: startBox.y + dyPx / bounds.height,
        }),
        'move',
      ),
    );
    moveEvent.preventDefault();
  };
  const finish = (): void => {
    teardown();
    const next = dragBox;
    dragBox = undefined;
    if (dragging && next) commitFloatingBox(id, next);
  };
  const cancel = (): void => {
    teardown();
    dragBox = undefined;
  };
  function teardown(): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
  }
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
}

function nudge(id: string, box: FloatingInstrumentBox, dx: number, dy: number): void {
  commitFloatingBox(
    id,
    snapToAlignment(
      snapFloatingBoxToGrid(clampFloatingBox({ ...box, x: box.x + dx, y: box.y + dy }), 'move'),
    ),
  );
}

function grow(id: string, box: FloatingInstrumentBox, dWidth: number, dHeight: number): void {
  commitFloatingBox(
    id,
    snapToAlignment(
      snapFloatingBoxToGrid(
        clampFloatingBox({ ...box, width: box.width + dWidth, height: box.height + dHeight }),
        'resize',
      ),
    ),
  );
}

function removeInstrument(id: string): void {
  floatingAspectRatios.delete(id);
  controller.removeFloating(id);
}

function addAt(at: { x?: number; y?: number }, id: string): void {
  controller.addFloating(id, at);
}

function addFromMenu(id: string): void {
  const verticalCount = controller.floating.filter((box) =>
    isVerticalHistoryViz(controller.resolve(box.id)?.viz),
  ).length;
  addAt(
    isVerticalHistoryViz(controller.resolve(id)?.viz)
      ? { x: 0.6 + verticalCount * (VERTICAL_HISTORY_FLOATING_WIDTH + 0.02), y: 0.12 }
      : { x: 0.6, y: 0.12 },
    id,
  );
}

function toggleAddMenu(): void {
  addMenuOpen = !addMenuOpen;
  helpOpen = false;
}

function toggleHelp(): void {
  helpOpen = !helpOpen;
  addMenuOpen = false;
}

function clearLongPress(): void {
  if (longPressTimer !== undefined) clearTimeout(longPressTimer);
  longPressTimer = undefined;
  longPressStart = undefined;
}

function beginLongPress(event: PointerEvent): void {
  if (event.button !== 0) return;
  clearLongPress();
  longPressStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => {
    longPressTimer = undefined;
    longPressStart = undefined;
    onEdit();
  }, EDIT_LONG_PRESS_MS);
}

function moveLongPress(event: PointerEvent): void {
  if (!longPressStart || event.pointerId !== longPressStart.pointerId) return;
  if (
    Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) >
    DRAG_THRESHOLD_PX
  ) {
    clearLongPress();
  }
}

function endLongPress(event: PointerEvent): void {
  if (event.pointerId === longPressStart?.pointerId) clearLongPress();
}

function handleDragOver(event: DragEvent): void {
  if (!editing || !event.dataTransfer) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function handleDrop(event: DragEvent): void {
  if (!editing) return;
  event.preventDefault();
  const id = event.dataTransfer?.getData(DRAG_MIME);
  if (!id) return;
  placeAt(id, event.clientX, event.clientY);
}

function placeAt(id: string, clientX: number, clientY: number): void {
  const point = normalizedPoint(clientX, clientY);
  if (!point) return;
  // Dropping an already-placed instrument moves it (keeping its saved size) to the drop point;
  // dropping a dock tile places a default box centered on the drop point.
  const current = controller.floating.find((box) => box.id === id);
  if (current) {
    const visible = displayedBox(current);
    commitFloatingBox(
      id,
      snapToAlignment(
        snapFloatingBoxToGrid(
          clampFloatingBox({
            ...visible,
            x: point.x - visible.width / 2,
            y: point.y - visible.height / 2,
          }),
          'move',
        ),
      ),
    );
    return;
  }
  const def = controller.resolve(id);
  const width = isVerticalHistoryViz(def?.viz)
    ? VERTICAL_HISTORY_FLOATING_WIDTH
    : DEFAULT_FLOATING_WIDTH;
  const height = isVerticalHistoryViz(def?.viz)
    ? VERTICAL_HISTORY_FLOATING_HEIGHT
    : DEFAULT_FLOATING_HEIGHT;
  const placed = snapToAlignment(
    snapFloatingBoxToGrid(
      clampFloatingBox({
        id,
        width,
        height,
        x: point.x - width / 2,
        y: point.y - height / 2,
      }),
      'move',
    ),
  );
  addAt({ x: placed.x, y: placed.y }, id);
}

function previewAt(id: string, clientX: number, clientY: number): void {
  const point = normalizedPoint(clientX, clientY);
  if (!point) return;
  const current = controller.floating.find((box) => box.id === id);
  const visible = current ? displayedBox(current) : undefined;
  const vertical = isVerticalHistoryViz(controller.resolve(id)?.viz);
  const width =
    visible?.width ?? (vertical ? VERTICAL_HISTORY_FLOATING_WIDTH : DEFAULT_FLOATING_WIDTH);
  const height =
    visible?.height ?? (vertical ? VERTICAL_HISTORY_FLOATING_HEIGHT : DEFAULT_FLOATING_HEIGHT);
  dropPreview = clampFloatingBox({
    id,
    width,
    height,
    x: point.x - width / 2,
    y: point.y - height / 2,
  });
  dropPreview = snapFloatingBoxToGrid(dropPreview, 'move');
}

// The dock emits pointer drag updates for every input type. This is more reliable than native HTML
// drag-and-drop across Safari and touch browsers, and lets the chart show the exact drop footprint.
$effect(() => {
  if (!editing) return;
  const handleDockDrag = (event: Event): void => {
    const drop = (
      event as CustomEvent<{
        id?: string;
        clientX?: number;
        clientY?: number;
        phase?: 'move' | 'drop';
      }>
    ).detail;
    if (
      !drop?.id ||
      typeof drop.clientX !== 'number' ||
      typeof drop.clientY !== 'number' ||
      !layerEl
    ) {
      dropPreview = undefined;
      return;
    }
    const bounds = layerEl.getBoundingClientRect();
    if (
      drop.clientX < bounds.left ||
      drop.clientX > bounds.right ||
      drop.clientY < bounds.top ||
      drop.clientY > bounds.bottom
    ) {
      dropPreview = undefined;
      return;
    }
    if (drop.phase === 'move') previewAt(drop.id, drop.clientX, drop.clientY);
    else {
      placeAt(drop.id, drop.clientX, drop.clientY);
      dropPreview = undefined;
    }
  };
  window.addEventListener('binnacle:instrument-dock-drag', handleDockDrag);
  return () => window.removeEventListener('binnacle:instrument-dock-drag', handleDockDrag);
});

function finishEditing(): void {
  addMenuOpen = false;
  helpOpen = false;
  onDone();
}
</script>

<!-- biome-ignore lint/a11y/noStaticElementInteractions: the layer root is the HTML5 drop target for dock tiles during screen edit mode; it carries no pointer interaction itself. -->
<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the group role (and the label that names it) exists exactly while editing, which Biome cannot resolve statically. -->
<div
  class="instrument-screen-layer"
  class:instrument-screen-layer--editing={editing}
  bind:this={layerEl}
  use:observeLayer
  ondragover={handleDragOver}
  ondrop={handleDrop}
  aria-label={editing ? 'Instrument screen layout editing' : undefined}
  role={editing ? 'group' : undefined}
>
  {#if editing}
    {#if windRoseSettingsOpen}
      <div class="screen-edit-settings">
        <WindRoseSettings
          noGoAngleRad={windRoseNoGoAngleRad}
          arcMarginRad={windRoseArcMarginRad}
          onChange={onWindRoseNoGoAngleChange}
          onArcMarginChange={onWindRoseArcMarginChange}
          onBack={() => (windRoseSettingsOpen = false)}
        />
      </div>
    {:else}
      <div class="screen-edit-chrome" role="toolbar" aria-label="Instrument editing actions">
        <button
          type="button"
          class="btn"
          bind:this={addMenuTrigger}
          aria-expanded={addMenuOpen}
          onclick={toggleAddMenu}
        >
          <Plus size={16} aria-hidden="true" />
          Add instrument
        </button>
        <button type="button" class="btn btn-primary" onclick={finishEditing}>Done</button>
        <button
          type="button"
          class="btn screen-edit-help-trigger"
          bind:this={helpTrigger}
          aria-label="Instrument editing help"
          aria-expanded={helpOpen}
          title="Instrument editing help"
          onclick={toggleHelp}
        >
          <CircleHelp size={18} aria-hidden="true" />
        </button>
      </div>
    {/if}
    {#if addMenuOpen}
      <AnchoredMenu
        open={true}
        onClose={() => (addMenuOpen = false)}
        backdropLabel="Dismiss add instrument menu"
        backdropClass="screen-add-backdrop"
        surfaceClass="popover-card screen-add-menu"
        ariaLabel="Add instrument to chart"
        role="menu"
        anchor={addMenuTrigger}
        preferredPlacement="below"
        anchorAlign="end"
        surfaceStyle="inline-size: min(16.25rem, calc(100vw - 2 * var(--space-3))); max-block-size: calc(100dvh - 2 * var(--space-3)); overflow: hidden;"
        onFocusLeft={() => (addMenuOpen = false)}
      >
        <div class="add-menu-scroll" use:rovingFocus={'[role="menuitem"]'}>
          {#if atFloatingCap && addable.length > 0}
            <p class="muted-note">Remove an instrument from the screen first.</p>
          {:else if !hasAddableEntry}
            <p class="muted-note">Every instrument is already on the screen.</p>
          {/if}
          {#each instrumentAliases as alias (alias.id)}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onclick={() => {
                alias.onToggle(!alias.visible);
                addMenuOpen = false;
              }}
            >
              {#if alias.visible}
                <X size={16} aria-hidden="true" />
                Remove {alias.label}
              {:else}
                <Plus size={16} aria-hidden="true" />
                Add {alias.label}
              {/if}
            </button>
          {/each}
          {#each addable as entry (entry.def.id)}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              disabled={atFloatingCap}
              onclick={() => {
                addFromMenu(entry.def.id);
                addMenuOpen = false;
              }}
            >
              <Plus size={16} aria-hidden="true" />
              {entry.title}
            </button>
          {/each}
        </div>
      </AnchoredMenu>
    {/if}
    {#if helpOpen}
      <AnchoredMenu
        open={true}
        onClose={() => (helpOpen = false)}
        backdropLabel="Dismiss instrument editing help"
        backdropClass="screen-add-backdrop"
        surfaceClass="popover-card screen-edit-help"
        ariaLabel="Instrument editing help"
        anchor={helpTrigger}
        preferredPlacement="below"
        anchorAlign="end"
        onFocusLeft={() => (helpOpen = false)}
      >
        <p class="muted-note">
          Drag an instrument to move it. Use its corner controls to resize, expand, or remove it.
          Select Done when the layout is ready.
        </p>
        {#if hasWindRose}
          <button
            type="button"
            class="btn"
            onclick={() => {
              helpOpen = false;
              windRoseSettingsOpen = true;
            }}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Wind rose settings
          </button>
        {/if}
      </AnchoredMenu>
    {/if}
  {/if}

  {#if editing}
    <span id="screen-edit-note" class="visually-hidden">
      Drag an instrument to move it. Use its corner controls to resize, expand, or remove it.
    </span>
    <span class="visually-hidden" role="status">{alignmentAnnouncement}</span>
  {/if}

  {#each floatingTiles as entry (`${entry.def.id}:${layoutEpoch}`)}
    {@const box = dragBox && dragBox.id === entry.def.id ? dragBox : displayedBox(entry.box)}
    {@const visibleBox = box}
    {@const expanded = expandedId === entry.def.id}
    {@const reading = entry.def.read(deps)}
    {@const zone = controller.zoneState(entry.def, reading.siValue)}
    {@const attitudeZones =
      entry.def.kind === 'attitude'
        ? {
            pitch: controller.zoneStateForProperty(entry.def.zonesPath, 'pitch', reading.pitchRad),
            roll: controller.zoneStateForProperty(entry.def.zonesPath, 'roll', reading.rollRad),
          }
        : undefined}
    {@const staleAge = staleAgeText(deps, entry.def, reading)}
    {@const depthZone =
      entry.def.kind === 'wind-rose' && depthDef && reading.windRose
        ? controller.zoneState(depthDef, reading.windRose.depth.siValue)
        : 'normal'}
    <div
      class="floating-frame"
      class:floating-frame--dragging={dragBox?.id === entry.def.id}
      class:floating-frame--expanded={expanded}
      style:left={expanded ? '0' : `${visibleBox.x * 100}%`}
      style:top={expanded ? '0' : `${visibleBox.y * 100}%`}
      style:width={expanded ? '100%' : `${visibleBox.width * 100}%`}
      style:height={expanded ? '100%' : `${visibleBox.height * 100}%`}
      style:opacity={overlayOpacity}
      data-instrument-id={entry.def.id}
      data-instrument-label={controller.resolvedLabel(entry.def)}
      role="group"
      aria-label={editing
        ? `Arrange ${controller.resolvedLabel(entry.def)}`
        : controller.resolvedLabel(entry.def)}
      onpointerdown={(event) => {
        if (editing) beginBodyDrag(entry.def.id, box, event);
        else beginLongPress(event);
      }}
      onpointermove={(event) => !editing && moveLongPress(event)}
      onpointerup={(event) => !editing && endLongPress(event)}
      onpointercancel={() => clearLongPress()}
    >
      <InstrumentTile
        def={entry.def}
        label={controller.resolvedLabel(entry.def)}
        {reading}
        {zone}
        {attitudeZones}
        {depthZone}
        staleAgeText={staleAge}
        sparkPoints={entry.def.viz === 'spark' ? history.series(entry.def.id) : undefined}
        historyPoints={isVerticalHistoryViz(entry.def.viz)
          ? verticalHistory.timedSeries(entry.def.id)
          : undefined}
        historyMaximumPoints={entry.def.viz === 'vertical-speed'
          ? verticalHistory.timedSeries(maximumHistoryId(entry.def.id))
          : undefined}
        historyNowMs={deps.clock.now}
        historyWindowMinutes={isVerticalHistoryViz(entry.def.viz)
          ? verticalHistoryWindowMinutesFor(historyWindows, entry.def.id)
          : undefined}
        onHistoryWindowChange={isVerticalHistoryViz(entry.def.viz)
          ? (minutes) => onHistoryWindowChange(entry.def.id, minutes)
          : undefined}
        {aisRadar}
        mapInstrument={editing ? undefined : mapInstrument}
        {windRoseNoGoAngleRad}
        {windRoseArcMarginRad}
        {expanded}
        onActivate={() => (expandedId = expanded ? undefined : entry.def.id)}
        onTideSettings={entry.def.kind === 'tide' ? onOpenTideSettings : undefined}
      />
      {#if editing}
        <button
          type="button"
          class="icon-btn frame-handle frame-handle--move"
          aria-label={`Move ${controller.resolvedLabel(entry.def)} on chart`}
          aria-describedby="screen-edit-note"
          onpointerdown={(event) => {
            event.stopPropagation();
            beginDrag('move', entry.def.id, box, event);
          }}
          onkeydown={(event) => {
            if (event.key === 'ArrowLeft') nudge(entry.def.id, box, -NUDGE_STEP, 0);
            else if (event.key === 'ArrowRight') nudge(entry.def.id, box, NUDGE_STEP, 0);
            else if (event.key === 'ArrowUp') nudge(entry.def.id, box, 0, -NUDGE_STEP);
            else if (event.key === 'ArrowDown') nudge(entry.def.id, box, 0, NUDGE_STEP);
            else return;
            event.preventDefault();
          }}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn frame-handle frame-handle--resize"
          aria-label={`Resize ${controller.resolvedLabel(entry.def)}`}
          aria-describedby="screen-edit-note"
          onpointerdown={(event) => {
            event.stopPropagation();
            beginDrag('resize', entry.def.id, box, event);
          }}
          onkeydown={(event) => {
            if (event.key === 'ArrowLeft') grow(entry.def.id, box, -NUDGE_STEP, 0);
            else if (event.key === 'ArrowRight') grow(entry.def.id, box, NUDGE_STEP, 0);
            else if (event.key === 'ArrowUp') grow(entry.def.id, box, 0, NUDGE_STEP);
            else if (event.key === 'ArrowDown') grow(entry.def.id, box, 0, -NUDGE_STEP);
            else return;
            event.preventDefault();
          }}
        >
          <Expand size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn frame-handle frame-handle--expand"
          aria-label={`${expanded ? 'Restore' : 'Expand'} ${controller.resolvedLabel(entry.def)}`}
          onclick={(event) => {
            event.stopPropagation();
            expandedId = expanded ? undefined : entry.def.id;
          }}
          onpointerdown={(event) => event.stopPropagation()}
        >
          <Expand size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn frame-handle frame-handle--remove"
          aria-label={`Remove ${controller.resolvedLabel(entry.def)} from chart`}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => removeInstrument(entry.def.id)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/each}
  {#each alignmentGuides as guide (`${guide.axis}:${guide.value}`)}
    <div
      class:alignment-guide--vertical={guide.axis === 'x'}
      class:alignment-guide--horizontal={guide.axis === 'y'}
      class="alignment-guide"
      style:inset-inline-start={guide.axis === 'x' ? `${guide.value * 100}%` : undefined}
      style:inset-block-start={guide.axis === 'y' ? `${guide.value * 100}%` : undefined}
      aria-hidden="true"
    ></div>
  {/each}
  {#if editing && dropPreview}
    <div
      class="floating-drop-preview"
      style:left={`${dropPreview.x * 100}%`}
      style:top={`${dropPreview.y * 100}%`}
      style:width={`${dropPreview.width * 100}%`}
      style:height={`${dropPreview.height * 100}%`}
      aria-hidden="true"
    ></div>
  {/if}
</div>

<style>
.instrument-screen-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.instrument-screen-layer--editing {
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--border) 24%, transparent) 0.05rem,
      transparent 0.05rem
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--border) 24%, transparent) 0.05rem,
      transparent 0.05rem
    );
  background-size: 2% 2%;
  pointer-events: auto;
}
.screen-edit-chrome {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  z-index: var(--z-menu);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-inline-size: calc(100% - 2 * var(--space-3));
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
  transform: translate(-50%, -50%);
}
.screen-edit-help-trigger {
  flex: none;
  inline-size: var(--control-size);
  padding: 0;
}
.screen-edit-settings {
  position: absolute;
  z-index: calc(var(--z-menu) + 1);
  inset: var(--space-3);
  max-inline-size: 28rem;
  margin-inline: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-lg);
}
.floating-frame {
  position: absolute;
  display: flex;
  min-inline-size: 6rem;
  min-block-size: 4rem;
  overflow: hidden;
  /* The layer itself is click-through to preserve chart gestures, but each placed instrument is
     a real control: open it, use its built-in controls, and click it again to restore its size. */
  pointer-events: auto;
}
.instrument-screen-layer--editing .floating-frame {
  /* The frame body is the touch drag surface, so the browser must not begin a map pan first. */
  touch-action: none;
}
.floating-frame :global(.tile) {
  flex: 1;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 0;
  max-inline-size: 100%;
  max-block-size: 100%;
  overflow: hidden;
}
.floating-frame--dragging :global(.tile) {
  outline: 2px solid var(--accent);
  opacity: 0.85;
}
.floating-frame--expanded {
  z-index: 3;
}
.floating-drop-preview {
  position: absolute;
  z-index: 1;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  pointer-events: none;
}
.frame-handle {
  position: absolute;
  z-index: 1;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  color: var(--accent);
  opacity: 0.9;
}
.frame-handle:hover,
.frame-handle:focus-visible {
  opacity: 1;
}
.frame-handle--move {
  inset-block-start: var(--space-1);
  inset-inline-start: var(--space-1);
  cursor: grab;
  touch-action: none;
}
.frame-handle--resize {
  inset-block-end: var(--space-1);
  inset-inline-end: var(--space-1);
  cursor: nwse-resize;
  touch-action: none;
}
.frame-handle--remove {
  inset-block-start: var(--space-1);
  inset-inline-end: var(--space-1);
}
.frame-handle--expand {
  inset-block-end: var(--space-1);
  inset-inline-start: var(--space-1);
}
.alignment-guide {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  background: var(--ok);
  box-shadow: 0 0 0.25rem color-mix(in srgb, var(--ok) 80%, transparent);
}
.alignment-guide--vertical {
  inset-block: 0;
  inline-size: 2px;
}
.alignment-guide--horizontal {
  inset-inline: 0;
  block-size: 2px;
}
:global(.screen-add-backdrop) {
  z-index: var(--z-menu);
}
:global(.screen-add-menu) {
  position: fixed;
  z-index: calc(var(--z-menu) + 1);
  padding: var(--space-1);
}
:global(.screen-edit-help) {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  inline-size: min(18rem, calc(100vw - 2 * var(--space-3)));
  padding: var(--space-3);
}
:global(.screen-edit-help .muted-note) {
  margin: 0;
}
.add-menu-scroll {
  display: flex;
  flex-direction: column;
  max-block-size: calc(100dvh - 3 * var(--space-3));
  min-block-size: 0;
  overflow-block: auto;
  overscroll-behavior-block: contain;
}
</style>

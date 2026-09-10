<script lang="ts">
import Grip from '@lucide/svelte/icons/grip';
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import { type Snippet, untrack } from 'svelte';
import type { Action } from 'svelte/action';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import {
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
} from '$shared/settings';
import type { Theme } from '$shared/ui';
import { createReorder, dialog, trapFocus } from '$shared/ui';
import { type AisRadarRangeNm, DEFAULT_AIS_RADAR_RANGE_NM } from './ais-radar-model';
import { DEFAULT_INSTRUMENT_DOCK_WIDTH_PX } from './dock-width';
import InstrumentContextMenu from './InstrumentContextMenu.svelte';
import InstrumentDetail from './InstrumentDetail.svelte';
import InstrumentDockResize from './InstrumentDockResize.svelte';
import InstrumentsCustomize from './InstrumentsCustomize.svelte';
import InstrumentTile from './InstrumentTile.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import { staleAgeText, type TileDeps } from './tile-catalog';
import {
  createTileHistory,
  isSessionHistoryViz,
  isVerticalHistoryViz,
} from './tile-history.svelte';
import {
  type InstrumentTileLayouts,
  type instrumentTileSizeFor,
  resizeInstrumentTile,
} from './tile-layout';
import WindRoseSettings from './WindRoseSettings.svelte';

const TOUCH_DRAG_THRESHOLD_PX = 10;
const TILE_RESIZE_THRESHOLD_PX = 12;

interface TouchDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
  aisTargets?: AisTargets;
  collision?: CollisionAssessment;
  aisRadarRangeNm?: AisRadarRangeNm;
  onAisRadarRangeChange?: (rangeNm: AisRadarRangeNm) => void;
  theme?: Theme;
  companionBase?: string | null;
  chartToken?: string;
  mapInstrument?: Snippet<[boolean, string, () => void]>;
  initialExpandedRequest?: { id: string; sequence: number };
  onExpandedRequestHandled?: () => void;
  initialDetailId?: string;
  restoreTrendFocusId?: string;
  onViewTrend?: (id: string) => void;
  onTrendFocusRestored?: () => void;
  fullscreen?: boolean;
  dockWidth?: number;
  onDockResize?: (width: number) => void;
  onDockResizeCommit?: (width: number) => void;
  tileLayouts?: InstrumentTileLayouts;
  onTileLayoutsChange?: (layouts: InstrumentTileLayouts) => void;
  // The emergency action the shell injects (the MOB trigger): while the panel is a full-screen
  // modal, aria-modal removes the topbar from the accessibility tree, so the trigger must live
  // inside the dialog subtree. Injected rather than imported so instruments never reaches into
  // the mob feature.
  emergencyAction?: Snippet;
  // The shell lock remains reachable when this panel covers the normal bottom toolbar.
  lockAction?: Snippet;
  onOpenTideSettings?: () => void;
  windRoseNoGoAngleRad?: number;
  onWindRoseNoGoAngleChange?: (angleRad: number) => void;
  windRoseArcMarginRad?: number;
  onWindRoseArcMarginChange?: (angleRad: number) => void;
  initialWindRoseSettingsRequest?: { sequence: number };
  onWindRoseSettingsRequestHandled?: () => void;
  initialCustomizeRequest?: { sequence: number };
  onCustomizeRequestHandled?: () => void;
  // True while the screen edit mode is active over the chart, so each tile becomes a drag source
  // for placement on the chart.
  screenEditing?: boolean;
  overlayOpacity?: number;
  onOverlayOpacityChange?: (opacity: number) => void;
}

const {
  controller,
  deps,
  aisTargets,
  collision,
  aisRadarRangeNm = DEFAULT_AIS_RADAR_RANGE_NM,
  onAisRadarRangeChange = () => {},
  theme = 'day',
  companionBase,
  chartToken,
  mapInstrument,
  initialExpandedRequest,
  onExpandedRequestHandled,
  initialDetailId,
  restoreTrendFocusId,
  onViewTrend,
  onTrendFocusRestored,
  fullscreen = false,
  dockWidth = DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  onDockResize = () => {},
  onDockResizeCommit = () => {},
  tileLayouts = {},
  onTileLayoutsChange = () => {},
  emergencyAction,
  lockAction,
  onOpenTideSettings,
  windRoseNoGoAngleRad = DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
  onWindRoseNoGoAngleChange = () => {},
  windRoseArcMarginRad = DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  onWindRoseArcMarginChange = () => {},
  initialWindRoseSettingsRequest,
  onWindRoseSettingsRequestHandled,
  initialCustomizeRequest,
  onCustomizeRequestHandled,
  screenEditing = false,
  overlayOpacity = 1,
  onOverlayOpacityChange = () => {},
}: Props = $props();

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

let customizing = $state(false);
let reordering = $state(false);
let detailId = $state<string | undefined>();
let expandedId = $state<string | undefined>();
let windRoseSettingsOpen = $state(false);
let tilesEl = $state<HTMLElement | undefined>();
let touchDrag = $state<TouchDrag | undefined>();
let tileResize = $state<
  | {
      id: string;
      pointerId: number;
      startX: number;
      startY: number;
      size: ReturnType<typeof instrumentTileSizeFor>;
    }
  | undefined
>();
let instrumentMenu = $state<{
  id?: string;
  label?: string;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  trigger: HTMLElement;
}>();
$effect(() => {
  if (initialDetailId && detailId === undefined) detailId = initialDetailId;
});
$effect(() => {
  if (!initialWindRoseSettingsRequest) return;
  void initialWindRoseSettingsRequest.sequence;
  detailId = undefined;
  expandedId = undefined;
  customizing = false;
  reordering = false;
  windRoseSettingsOpen = true;
  onWindRoseSettingsRequestHandled?.();
});
$effect(() => {
  if (!initialCustomizeRequest) return;
  void initialCustomizeRequest.sequence;
  detailId = undefined;
  expandedId = undefined;
  windRoseSettingsOpen = false;
  reordering = false;
  customizing = true;
  onCustomizeRequestHandled?.();
});
$effect(() => {
  if (!initialExpandedRequest) return;
  void initialExpandedRequest.sequence;
  detailId = undefined;
  windRoseSettingsOpen = false;
  customizing = false;
  reordering = false;
  expandedId = initialExpandedRequest.id;
  onExpandedRequestHandled?.();
});

// Hoisted so the tile selection resolves (validate the persisted ids, scan the catalog) once per
// real change instead of once per clock tick: both the effect below and the template read this.
const tiles = $derived(controller.tiles);
const detailDef = $derived(detailId ? tiles.find((def) => def.id === detailId) : undefined);
const expandedDef = $derived(expandedId ? controller.resolve(expandedId) : undefined);

const reorder = createReorder({
  getItems: () => tiles.map((def) => ({ id: def.id, title: controller.resolvedLabel(def) })),
  getListEl: () => tilesEl,
  commit: (id, slot) => controller.reorderTile(id, slot),
  rowAttribute: 'data-tile-row',
  handleSelector: '.tile-reorder-handle',
  itemNoun: 'Instrument',
  layout: 'grid',
});

function spansWholeRow(kind: string, state: string): boolean {
  return (
    kind === 'wind-rose' ||
    kind === 'ais-radar' ||
    kind === 'map' ||
    kind === 'webview' ||
    kind === 'tide' ||
    (state !== 'never' && (kind === 'wind' || kind === 'position' || kind === 'battery'))
  );
}

function tileSize(
  def: { id: string; kind: string; viz?: string },
  state: string,
): ReturnType<typeof instrumentTileSizeFor> {
  if (spansWholeRow(def.kind, state)) return 'wide';
  return tileLayouts[def.id] ?? (isVerticalHistoryViz(def.viz) ? 'tall' : 'normal');
}

function beginTileResize(
  def: { id: string; kind: string; viz?: string },
  state: string,
  event: PointerEvent,
): void {
  if (!reordering || event.button !== 0 || spansWholeRow(def.kind, state)) return;
  tileResize = {
    id: def.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    size: tileSize(def, state),
  };
  if (event.currentTarget instanceof Element)
    event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function finishTileResize(event: PointerEvent): void {
  if (!tileResize || event.pointerId !== tileResize.pointerId) return;
  const resize = tileResize;
  tileResize = undefined;
  const next = resizeInstrumentTile(
    resize.size,
    Math.abs(event.clientX - resize.startX) >= TILE_RESIZE_THRESHOLD_PX
      ? event.clientX - resize.startX
      : 0,
    Math.abs(event.clientY - resize.startY) >= TILE_RESIZE_THRESHOLD_PX
      ? event.clientY - resize.startY
      : 0,
  );
  if (next === resize.size) return;
  const layouts = { ...tileLayouts };
  if (next === 'normal' && !isVerticalHistoryViz(controller.resolve(resize.id)?.viz))
    delete layouts[resize.id];
  else layouts[resize.id] = next;
  onTileLayoutsChange(layouts);
}

const instrumentContextMenu: Action<HTMLElement> = (node) => {
  const tileFromTarget = (eventTarget: EventTarget | null): HTMLButtonElement | undefined => {
    const tile =
      eventTarget instanceof Element
        ? eventTarget.closest<HTMLButtonElement>('button.tile')
        : undefined;
    return tile && node.contains(tile) ? tile : undefined;
  };
  const openMenu = (trigger: HTMLElement, x?: number, y?: number): void => {
    const tile = tileFromTarget(trigger);
    const shell = tile?.closest<HTMLElement>('[data-instrument-id]');
    const focusTrigger = tile ?? trigger;
    const bounds = focusTrigger.getBoundingClientRect();
    instrumentMenu = {
      id: shell?.dataset.instrumentId,
      label: shell?.dataset.instrumentLabel,
      x: x ?? bounds.left + bounds.width / 2,
      y: y ?? bounds.top + bounds.height / 2,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      trigger: focusTrigger,
    };
  };
  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const keyboardPosition = event.clientX === 0 && event.clientY === 0;
    openMenu(
      event.target instanceof HTMLElement ? event.target : node,
      keyboardPosition ? undefined : event.clientX,
      keyboardPosition ? undefined : event.clientY,
    );
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    openMenu(event.target instanceof HTMLElement ? event.target : node);
  };
  node.addEventListener('contextmenu', handleContextMenu);
  node.addEventListener('keydown', handleKeydown);
  return {
    destroy(): void {
      node.removeEventListener('contextmenu', handleContextMenu);
      node.removeEventListener('keydown', handleKeydown);
    },
  };
};

function closeInstrumentMenu(): void {
  const trigger = instrumentMenu?.trigger;
  instrumentMenu = undefined;
  requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
}

function inspectInstrument(): void {
  const id = instrumentMenu?.id;
  if (!id) return;
  instrumentMenu = undefined;
  expandedId = undefined;
  detailId = id;
  windRoseSettingsOpen = false;
}

function configureWindRose(): void {
  instrumentMenu = undefined;
  detailId = undefined;
  expandedId = undefined;
  customizing = false;
  reordering = false;
  windRoseSettingsOpen = true;
}

function toggleReordering(): void {
  instrumentMenu = undefined;
  detailId = undefined;
  windRoseSettingsOpen = false;
  customizing = false;
  reordering = !reordering;
}

function toggleCustomizing(): void {
  instrumentMenu = undefined;
  detailId = undefined;
  windRoseSettingsOpen = false;
  reordering = false;
  customizing = !customizing;
}

function closePanel(): void {
  instrumentMenu = undefined;
  controller.setOpen(false);
}

// Pointer capture keeps a dock-to-chart drag intact when the pointer leaves the dock. A tap stays
// a normal tile activation; a moved pointer is sent to the chart layer for its live drop preview.
function handleTilePointerDown(id: string, event: PointerEvent): void {
  if (!screenEditing) return;
  touchDrag = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  if (event.currentTarget instanceof Element)
    event.currentTarget.setPointerCapture(event.pointerId);
}

function handleTilePointerMove(event: PointerEvent): void {
  if (!touchDrag || event.pointerId !== touchDrag.pointerId) return;
  if (
    !touchDrag.moved &&
    Math.hypot(event.clientX - touchDrag.startX, event.clientY - touchDrag.startY) >=
      TOUCH_DRAG_THRESHOLD_PX
  ) {
    touchDrag = { ...touchDrag, moved: true };
  }
  if (touchDrag.moved) {
    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent('binnacle:instrument-dock-drag', {
        detail: { id: touchDrag.id, clientX: event.clientX, clientY: event.clientY, phase: 'move' },
      }),
    );
  }
}

function finishTileTouchDrag(event: PointerEvent): void {
  if (!touchDrag || event.pointerId !== touchDrag.pointerId) return;
  const drag = touchDrag;
  touchDrag = undefined;
  if (!drag.moved) return;
  event.preventDefault();
  window.dispatchEvent(
    new CustomEvent('binnacle:instrument-dock-drag', {
      detail: { id: drag.id, clientX: event.clientX, clientY: event.clientY, phase: 'drop' },
    }),
  );
}

function placeInstrumentOnChart(): void {
  const id = instrumentMenu?.id;
  if (!id) return;
  instrumentMenu = undefined;
  controller.addFloating(id);
}

// Session-only tile history: sampled here on the shared reactive clock so the buffers only
// accumulate while the dock is mounted, matching the subscription lifecycle. The reads are
// untracked so the effect re-runs on the 1 Hz clock and selection changes, not on every delta
// flush. Stale retained values are not appended as if they were fresh observations.
const history = createTileHistory();
$effect(() => {
  const now = deps.clock.now;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set, never rendered
  const liveIds = new Set<string>();
  for (const def of tiles) {
    if (!isSessionHistoryViz(def.viz)) continue;
    liveIds.add(def.id);
    const reading = untrack(() => def.read(deps));
    history.sample(def.id, reading.state === 'live' ? reading.siValue : undefined, now);
  }
  history.prune(liveIds);
});
</script>

{#snippet fixedLockAction()}
  {#if lockAction}
    <div class="instrument-lock-action">
      {@render lockAction()}
    </div>
  {/if}
{/snippet}

{#snippet instrumentActionsMenu()}
  {#if instrumentMenu}
    <InstrumentContextMenu
      label={instrumentMenu.label}
      x={instrumentMenu.x}
      y={instrumentMenu.y}
      viewportWidth={instrumentMenu.viewportWidth}
      viewportHeight={instrumentMenu.viewportHeight}
      {customizing}
      {reordering}
      onInspect={instrumentMenu.id && controller.resolve(instrumentMenu.id)?.kind !== 'webview'
          ? inspectInstrument
          : undefined}
      onConfigure={instrumentMenu.id === 'wind-rose' ? configureWindRose : undefined}
      onPlaceOnChart={screenEditing && instrumentMenu.id ? placeInstrumentOnChart : undefined}
      onToggleCustomize={toggleCustomizing}
      onToggleReorder={toggleReordering}
      onClosePanel={closePanel}
      onClose={closeInstrumentMenu}
    />
  {/if}
{/snippet}

<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is dialog exactly when aria-modal is defined. -->
<aside
  id="instrument-dock"
  class="instruments"
  class:instrument-focus={expandedDef !== undefined}
  role={fullscreen ? 'dialog' : undefined}
  aria-label="Instruments"
  aria-modal={fullscreen ? 'true' : undefined}
  tabindex="-1"
  use:dialog={() => controller.setOpen(false)}
  use:trapFocus={fullscreen && expandedDef === undefined}
  use:instrumentContextMenu
>
  {#if !fullscreen}
    <InstrumentDockResize width={dockWidth} onResize={onDockResize} onCommit={onDockResizeCommit} />
  {/if}
  {#if fullscreen && !expandedDef}
    {#if emergencyAction}
      <div class="instrument-emergency-action">{@render emergencyAction()}</div>
    {/if}
    {@render fixedLockAction()}
  {/if}
  {#if windRoseSettingsOpen}
    <WindRoseSettings
      noGoAngleRad={windRoseNoGoAngleRad}
      arcMarginRad={windRoseArcMarginRad}
      onChange={onWindRoseNoGoAngleChange}
      onArcMarginChange={onWindRoseArcMarginChange}
      onBack={() => (windRoseSettingsOpen = false)}
    />
  {:else if detailDef}
    {@const reading = detailDef.read(deps)}
    {@const zone = controller.zoneState(detailDef, reading.siValue)}
    <InstrumentDetail
      def={detailDef}
      label={controller.resolvedLabel(detailDef)}
      {deps}
      {reading}
      {zone}
      historicalOnly={controller.isHistoricalOnly(detailDef.id) &&
        detailDef.paths.every((path) => deps.store.cell(path).epoch === 0)}
      onBack={() => (detailId = undefined)}
      onViewTrend={controller.trendDescriptor(detailDef.id) && onViewTrend
        ? () => onViewTrend(detailDef.id)
        : undefined}
      restoreTrendFocus={restoreTrendFocusId === detailDef.id}
      {onTrendFocusRestored}
    />
  {:else if customizing}
    <div class="customize-instruction">
      <span class="muted-note">Tap an instrument to show or hide. Drag to reorder.</span>
    </div>
    <InstrumentsCustomize {controller} {deps} {overlayOpacity} {onOverlayOpacityChange} />
  {:else}
    <div class="instrument-config-action">
      <button type="button" class="btn btn-ghost" onclick={toggleCustomizing}>
        Customize instruments
      </button>
    </div>
    {#if reordering}
      <p id="instrument-reorder-instruction" class="reorder-instruction muted-note" role="status">
        Drag an instrument by its handle to move it. Select the open lock when done.
      </p>
    {/if}
    <div class="tiles" class:tiles--reordering={reordering} bind:this={tilesEl}>
      {#if tiles.length === 0}
        <p class="muted-note empty">No instruments shown. Use Customize to add one.</p>
      {/if}
      {#each tiles as def, i (def.id)}
        {@const indicator = reorder.indicatorFor(def.id)}
        {@const reading = def.read(deps)}
        {@const zone = controller.zoneState(def, reading.siValue)}
        {@const attitudeZones =
          def.kind === 'attitude'
            ? {
                pitch: controller.zoneStateForProperty(def.zonesPath, 'pitch', reading.pitchRad),
                roll: controller.zoneStateForProperty(def.zonesPath, 'roll', reading.rollRad),
              }
            : undefined}
        {@const staleAge = staleAgeText(deps, def, reading)}
        {@const depthZone =
          def.kind === 'wind-rose' && depthDef && reading.windRose
            ? controller.zoneState(depthDef, reading.windRose.depth.siValue)
            : 'normal'}
        {@const resolvedLabel = controller.resolvedLabel(def)}
        {@const size = tileSize(def, reading.state)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          data-tile-row={def.id}
          data-instrument-id={def.id}
          data-instrument-label={resolvedLabel}
          class="tile-shell"
          class:tile-shell--wide={size === 'wide'}
          class:tile-shell--tall={size === 'tall'}
          class:tile-shell--large={size === 'large'}
          class:reorder-row={reordering}
          class:dragging={reordering && reorder.dragId === def.id}
          class:drop-before={reordering && indicator.before}
          class:drop-after={reordering && indicator.after}
          onpointerdown={(event) => handleTilePointerDown(def.id, event)}
          onpointermove={handleTilePointerMove}
          onpointerup={finishTileTouchDrag}
          onpointercancel={finishTileTouchDrag}
        >
          <InstrumentTile
            {def}
            label={resolvedLabel}
            {reading}
            {zone}
            {attitudeZones}
            {depthZone}
            staleAgeText={staleAge}
            sparkPoints={def.viz === 'spark' ? history.series(def.id) : undefined}
            historyPoints={isVerticalHistoryViz(def.viz)
              ? history.timedSeries(def.id)
              : undefined}
            historyNowMs={deps.clock.now}
            {aisRadar}
            mapInstrument={expandedId === def.id ? undefined : mapInstrument}
            {windRoseNoGoAngleRad}
            {windRoseArcMarginRad}
            onActivate={() => (expandedId = def.id)}
            onTideSettings={def.kind === 'tide' ? onOpenTideSettings : undefined}
          />
          {#if reordering}
            <button
              type="button"
              class="icon-btn handle tile-reorder-handle"
              aria-label={`Move ${resolvedLabel}, position ${i + 1} of ${tiles.length}`}
              aria-describedby="instrument-reorder-instruction"
              aria-keyshortcuts="ArrowUp ArrowDown"
              onpointerdown={(event) => reorder.handlePointerDown(def.id, event)}
              onkeydown={(event) => reorder.handleKeydown(def.id, event)}
            >
              <GripVertical size={18} aria-hidden="true" />
            </button>
            {#if !spansWholeRow(def.kind, reading.state)}
              <button
                type="button"
                class="icon-btn handle tile-resize-handle"
                aria-label={`Resize ${resolvedLabel} in dock`}
                aria-describedby="instrument-reorder-instruction"
                onpointerdown={(event) => beginTileResize(def, reading.state, event)}
                onpointerup={finishTileResize}
                onpointercancel={() => (tileResize = undefined)}
              >
                <Grip size={16} aria-hidden="true" />
              </button>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
    <span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>
  {/if}

  {#if expandedDef}
    {@const reading = expandedDef.read(deps)}
    {@const zone = controller.zoneState(expandedDef, reading.siValue)}
    {@const attitudeZones =
      expandedDef.kind === 'attitude'
        ? {
            pitch: controller.zoneStateForProperty(
              expandedDef.zonesPath,
              'pitch',
              reading.pitchRad,
            ),
            roll: controller.zoneStateForProperty(expandedDef.zonesPath, 'roll', reading.rollRad),
          }
        : undefined}
    {@const staleAge = staleAgeText(deps, expandedDef, reading)}
    {@const depthZone =
      expandedDef.kind === 'wind-rose' && depthDef && reading.windRose
        ? controller.zoneState(depthDef, reading.windRose.depth.siValue)
        : 'normal'}
    <div
      class="expanded-instrument"
      role="dialog"
      aria-modal="true"
      aria-label={`${controller.resolvedLabel(expandedDef)} full-screen instrument`}
      tabindex="-1"
      use:dialog={() => (expandedId = undefined)}
      use:trapFocus={true}
      data-instrument-id={expandedDef.id}
      data-instrument-label={controller.resolvedLabel(expandedDef)}
    >
      <InstrumentTile
        def={expandedDef}
        label={controller.resolvedLabel(expandedDef)}
        {reading}
        {zone}
        {attitudeZones}
        {depthZone}
        staleAgeText={staleAge}
        sparkPoints={expandedDef.viz === 'spark' ? history.series(expandedDef.id) : undefined}
        historyPoints={isVerticalHistoryViz(expandedDef.viz)
          ? history.timedSeries(expandedDef.id)
          : undefined}
        historyNowMs={deps.clock.now}
        {aisRadar}
        {mapInstrument}
        {windRoseNoGoAngleRad}
        {windRoseArcMarginRad}
        expanded
        onActivate={() => (expandedId = undefined)}
        onTideSettings={expandedDef.kind === 'tide' ? onOpenTideSettings : undefined}
      />
      {@render fixedLockAction()}
      {@render instrumentActionsMenu()}
    </div>
  {/if}

  {#if !expandedDef}
    {@render instrumentActionsMenu()}
  {/if}
</aside>

<style>
.instrument-config-action {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-2) var(--space-3) 0;
}
.tiles {
  display: grid;
  /* The 40% arm caps the full-screen phone layout at two readable columns (and one column on a
     very narrow phone), while staying under the 9rem floor inside the 16-22rem dock. */
  grid-template-columns: repeat(auto-fill, minmax(max(9rem, 40%), 1fr));
  /* Not dense: a full-row tile after a lone half tile leaves a hole, and dense fills it by pulling
     a later narrow tile backward, which Tab (DOM order) does not follow. The gap costs a little
     space; a tab order that disagrees with the visual order costs a keyboard navigator the dock.
     Rows split the leftover dock height so the grid spans the dock, collapsing to min-content (and
     the existing scroll) when the tile set outgrows it. */
  grid-auto-flow: row;
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--space-2);
  flex: 1;
  min-block-size: 0;
  overflow: hidden;
  padding: var(--space-2) var(--space-3);
}
.tile-shell {
  position: relative;
  display: flex;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
}
.tile-shell--wide {
  grid-column: 1 / -1;
}
.tile-shell--tall {
  grid-row: span 2;
}
.tile-shell--large {
  grid-column: 1 / -1;
  grid-row: span 2;
}
.tile-shell :global(.tile) {
  flex: 1;
  inline-size: 100%;
}
.tiles--reordering .tile-shell :global(.tile) {
  outline: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: -2px;
}
.tile-shell.dragging :global(.tile) {
  outline: 2px solid var(--accent);
  box-shadow: var(--shadow-overlay);
  opacity: 0.78;
}
.tile-shell .tile-reorder-handle {
  position: absolute;
  inset-block-start: var(--space-1);
  inset-inline-end: var(--space-1);
  z-index: 1;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  color: var(--accent);
  opacity: 0.9;
}
.tile-shell .tile-resize-handle {
  position: absolute;
  inset-block-end: var(--space-1);
  inset-inline-end: var(--space-1);
  z-index: 1;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  color: var(--accent);
  cursor: nwse-resize;
  opacity: 0.9;
  touch-action: none;
}
.tile-shell .tile-resize-handle:hover,
.tile-shell .tile-resize-handle:focus-visible {
  opacity: 1;
}
.tile-shell .tile-reorder-handle:hover,
.tile-shell .tile-reorder-handle:focus-visible {
  opacity: 1;
}
/* Grid drops need a vertical insertion marker. This overrides the shared list row's horizontal
   marker while retaining the same accent, carried-tile treatment, and state classes. */
.tile-shell.reorder-row.drop-before::before,
.tile-shell.reorder-row.drop-after::after {
  inset-block: var(--space-1);
  inline-size: 3px;
  block-size: auto;
  border-radius: 999px;
}
.tile-shell.reorder-row.drop-before::before {
  inset-inline: auto;
  inset-inline-start: calc(var(--space-1) * -1);
}
.tile-shell.reorder-row.drop-after::after {
  inset-inline: auto;
  inset-inline-end: calc(var(--space-1) * -1);
}
.expanded-instrument {
  position: fixed;
  inset: 0;
  z-index: var(--z-menu);
  display: flex;
  background: var(--surface);
}
.expanded-instrument :global(.tile) {
  flex: 1;
  inline-size: 100%;
  block-size: 100%;
  border: 0;
  border-radius: 0;
}
.instrument-lock-action {
  position: fixed;
  inset-inline-end: calc(var(--space-4) + env(safe-area-inset-right, 0px));
  inset-block-end: calc(var(--space-2) + var(--system-bar-clearance));
  z-index: calc(var(--z-menu) + 1);
}
.instrument-emergency-action {
  position: fixed;
  inset-inline-start: calc(var(--space-4) + env(safe-area-inset-left, 0px));
  inset-block-end: calc(var(--space-2) + var(--system-bar-clearance));
  z-index: calc(var(--z-menu) + 1);
}
@media (max-width: 900px) {
  /* The full-screen dock sits under the floating safety rail; reserving the rail's measured
     clearance in the scroll area keeps the last tile row reachable during an alert. 0px when
     quiet, so the reserve costs nothing on a calm watch. */
  .tiles {
    padding-block-end: calc(var(--space-2) + var(--rail-clearance, 0px));
  }
}
.empty {
  grid-column: 1 / -1;
  align-self: start;
}

.customize-instruction {
  padding: 0 var(--space-3) var(--space-2);
}
.reorder-instruction {
  margin: 0;
  padding: 0 var(--space-3) var(--space-1);
}
</style>

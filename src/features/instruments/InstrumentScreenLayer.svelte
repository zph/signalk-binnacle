<script lang="ts">
import Expand from '@lucide/svelte/icons/expand';
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import Plus from '@lucide/svelte/icons/plus';
import X from '@lucide/svelte/icons/x';
import { type Snippet, untrack } from 'svelte';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import {
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
} from '$shared/settings';
import { AnchoredMenu, registerDismiss, rovingFocus, type Theme } from '$shared/ui';
import { type AisRadarRangeNm, DEFAULT_AIS_RADAR_RANGE_NM } from './ais-radar-model';
import {
  clampFloatingBox,
  DEFAULT_FLOATING_HEIGHT,
  DEFAULT_FLOATING_WIDTH,
  type FloatingInstrumentBox,
  MAX_FLOATING_INSTRUMENTS,
} from './floating-layout';
import InstrumentTile from './InstrumentTile.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import { instrumentOptionLabels, staleAgeText, type TileDeps } from './tile-catalog';
import { createTileHistory } from './tile-history.svelte';

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
  onOpenTideSettings?: () => void;
  // Called when the helm presses Done, so the shell can clear any edit-mode side effects.
  onDone?: () => void;
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
  onOpenTideSettings,
  onDone = () => {},
}: Props = $props();

const DRAG_MIME = 'text/x-binnacle-instrument';
const NUDGE_STEP = 0.02;

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
let addMenuOpen = $state(false);
let addMenuTrigger = $state<HTMLElement | undefined>();

// In-flight move or resize, so a drag renders its live box without writing storage per pointer
// event; the persisted box only changes when the pointer is released.
let dragBox = $state<FloatingInstrumentBox | undefined>();

const floatingTiles = $derived(controller.floatingTiles);
const editing = $derived(controller.screenEditing);
const atFloatingCap = $derived(floatingTiles.length >= MAX_FLOATING_INSTRUMENTS);

const optionLabels = $derived(instrumentOptionLabels(controller.catalog));
const addable = $derived.by(() => {
  const placed = new Set(floatingTiles.map(({ def }) => def.id));
  return controller.catalog
    .filter((def) => !placed.has(def.id))
    .map((def) => ({ def, title: optionLabels.get(def.id) ?? controller.resolvedLabel(def) }));
});

// Session sparkline history, sampled on the shared reactive clock exactly as the dock does.
const history = createTileHistory();
$effect(() => {
  const now = deps.clock.now;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set, never rendered
  const liveIds = new Set<string>();
  for (const { def } of floatingTiles) {
    if (def.viz !== 'spark') continue;
    liveIds.add(def.id);
    history.sample(
      def.id,
      untrack(() => def.read(deps).siValue),
      now,
    );
  }
  history.prune(liveIds);
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
      dragBox = clampFloatingBox({ ...startBox, x: startBox.x + dx, y: startBox.y + dy });
    } else {
      dragBox = clampFloatingBox({
        ...startBox,
        width: startBox.width + dx,
        height: startBox.height + dy,
      });
    }
    moveEvent.preventDefault();
  };
  // A release commits the live box; a cancel (an incoming call, a stolen gesture) discards it
  // without writing anything.
  const commit = (): void => {
    teardown();
    const next = dragBox;
    dragBox = undefined;
    if (next) controller.setFloatingBox(id, next);
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

function nudge(id: string, box: FloatingInstrumentBox, dx: number, dy: number): void {
  controller.setFloatingBox(id, clampFloatingBox({ ...box, x: box.x + dx, y: box.y + dy }));
}

function grow(id: string, box: FloatingInstrumentBox, dWidth: number, dHeight: number): void {
  controller.setFloatingBox(
    id,
    clampFloatingBox({ ...box, width: box.width + dWidth, height: box.height + dHeight }),
  );
}

function removeInstrument(id: string): void {
  controller.removeFloating(id);
}

function addAt(at: { x?: number; y?: number }, id: string): void {
  controller.addFloating(id, at);
}

function toggleAddMenu(): void {
  addMenuOpen = !addMenuOpen;
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
  const point = normalizedPoint(event.clientX, event.clientY);
  if (!point) return;
  // Dropping an already-placed instrument moves it (keeping its saved size) to the drop point;
  // dropping a dock tile places a default box centered on the drop point.
  const current = controller.floating.find((box) => box.id === id);
  if (current) {
    controller.setFloatingBox(
      id,
      clampFloatingBox({
        ...current,
        x: point.x - current.width / 2,
        y: point.y - current.height / 2,
      }),
    );
    return;
  }
  addAt(
    {
      x: point.x - DEFAULT_FLOATING_WIDTH / 2,
      y: point.y - DEFAULT_FLOATING_HEIGHT / 2,
    },
    id,
  );
}

function finishEditing(): void {
  addMenuOpen = false;
  onDone();
}
</script>

<!-- biome-ignore lint/a11y/noStaticElementInteractions: the layer root is the HTML5 drop target for dock tiles during screen edit mode; it carries no pointer interaction itself. -->
<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the group role (and the label that names it) exists exactly while editing, which Biome cannot resolve statically. -->
<div
  class="instrument-screen-layer"
  class:instrument-screen-layer--editing={editing}
  bind:this={layerEl}
  ondragover={handleDragOver}
  ondrop={handleDrop}
  aria-label={editing ? 'Instrument screen layout editing' : undefined}
  role={editing ? 'group' : undefined}
>
  {#if editing}
    <div class="screen-edit-chrome">
      <p id="screen-edit-note" class="muted-note screen-edit-note" role="status">
        Drag tiles from the instruments bar, or use Add instrument. Drag or resize each tile, then
        select Done to lock the layout.
      </p>
      <div class="screen-edit-actions">
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
      </div>
    </div>
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
        surfaceStyle="inline-size: 16.25rem; max-block-size: min(20rem, calc(100dvh - 2 * var(--space-3)));"
        onFocusLeft={() => (addMenuOpen = false)}
      >
        <div class="add-menu-scroll" use:rovingFocus={'[role="menuitem"]'}>
          {#if atFloatingCap}
            <p class="muted-note">Remove an instrument from the screen first.</p>
          {:else if addable.length === 0}
            <p class="muted-note">Every instrument is already on the screen.</p>
          {/if}
          {#each addable as entry (entry.def.id)}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              disabled={atFloatingCap}
              onclick={() => {
                addAt({ x: 0.6, y: 0.12 }, entry.def.id);
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
  {/if}

  {#each floatingTiles as entry (entry.def.id)}
    {@const box = dragBox && dragBox.id === entry.def.id ? dragBox : entry.box}
    {@const reading = entry.def.read(deps)}
    {@const zone = controller.zoneState(entry.def, reading.siValue)}
    {@const staleAge = staleAgeText(deps, entry.def, reading)}
    {@const depthZone =
      entry.def.kind === 'wind-rose' && depthDef && reading.windRose
        ? controller.zoneState(depthDef, reading.windRose.depth.siValue)
        : 'normal'}
    <div
      class="floating-frame"
      class:floating-frame--dragging={dragBox !== undefined}
      style:left={`${box.x * 100}%`}
      style:top={`${box.y * 100}%`}
      style:width={`${box.width * 100}%`}
      style:height={`${box.height * 100}%`}
      data-instrument-id={entry.def.id}
      data-instrument-label={controller.resolvedLabel(entry.def)}
      inert={!editing}
    >
      <InstrumentTile
        def={entry.def}
        label={controller.resolvedLabel(entry.def)}
        {reading}
        {zone}
        {depthZone}
        staleAgeText={staleAge}
        sparkPoints={entry.def.viz === 'spark' ? history.series(entry.def.id) : undefined}
        {aisRadar}
        mapInstrument={editing ? undefined : mapInstrument}
        {windRoseNoGoAngleRad}
        {windRoseArcMarginRad}
        onActivate={() => {}}
        onTideSettings={entry.def.kind === 'tide' ? onOpenTideSettings : undefined}
      />
      {#if editing}
        <button
          type="button"
          class="icon-btn frame-handle frame-handle--move"
          aria-label={`Move ${controller.resolvedLabel(entry.def)} on chart`}
          aria-describedby="screen-edit-note"
          onpointerdown={(event) => beginDrag('move', entry.def.id, box, event)}
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
          onpointerdown={(event) => beginDrag('resize', entry.def.id, box, event)}
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
          class="icon-btn frame-handle frame-handle--remove"
          aria-label={`Remove ${controller.resolvedLabel(entry.def)} from chart`}
          onclick={() => removeInstrument(entry.def.id)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
.instrument-screen-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.instrument-screen-layer--editing {
  pointer-events: auto;
}
.screen-edit-chrome {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline: var(--space-2);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: space-between;
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
}
.screen-edit-note {
  margin: 0;
}
.screen-edit-actions {
  display: flex;
  gap: var(--space-2);
}
.floating-frame {
  position: absolute;
  display: flex;
  min-inline-size: 6rem;
  min-block-size: 4rem;
}
.floating-frame :global(.tile) {
  flex: 1;
  inline-size: 100%;
}
.floating-frame--dragging :global(.tile) {
  outline: 2px solid var(--accent);
  opacity: 0.85;
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
:global(.screen-add-backdrop) {
  z-index: var(--z-menu);
}
:global(.screen-add-menu) {
  position: fixed;
  z-index: calc(var(--z-menu) + 1);
  padding: var(--space-1);
}
.add-menu-scroll {
  display: flex;
  flex-direction: column;
  max-block-size: inherit;
  overflow-block: auto;
}
</style>

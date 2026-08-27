<script lang="ts">
import CircleHelp from '@lucide/svelte/icons/circle-help';
import { type Snippet, untrack } from 'svelte';
import { CustomizeToggle, dialog, PanelHeader, trapFocus } from '$shared/ui';
import { DEFAULT_INSTRUMENT_DOCK_WIDTH_PX } from './dock-width';
import InstrumentDetail from './InstrumentDetail.svelte';
import InstrumentDockResize from './InstrumentDockResize.svelte';
import InstrumentsCustomize from './InstrumentsCustomize.svelte';
import InstrumentTile from './InstrumentTile.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import { staleAgeText, type TileDeps } from './tile-catalog';
import { createTileHistory } from './tile-history.svelte';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
  initialDetailId?: string;
  restoreTrendFocusId?: string;
  onViewTrend?: (id: string) => void;
  onTrendFocusRestored?: () => void;
  fullscreen?: boolean;
  dockWidth?: number;
  onDockResize?: (width: number) => void;
  onDockResizeCommit?: (width: number) => void;
  // The emergency action the shell injects (the MOB trigger): while the panel is a full-screen
  // modal, aria-modal removes the topbar from the accessibility tree, so the trigger must live
  // inside the dialog subtree. Injected rather than imported so instruments never reaches into
  // the mob feature.
  emergencyAction?: Snippet;
  // The shell lock remains reachable when this panel covers the normal bottom toolbar.
  lockAction?: Snippet;
}

const {
  controller,
  deps,
  initialDetailId,
  restoreTrendFocusId,
  onViewTrend,
  onTrendFocusRestored,
  fullscreen = false,
  dockWidth = DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  onDockResize = () => {},
  onDockResizeCommit = () => {},
  emergencyAction,
  lockAction,
}: Props = $props();

const depthDef = $derived(controller.resolve('depth'));

let customizing = $state(false);
let detailId = $state<string | undefined>();
let expandedId = $state<string | undefined>();
$effect(() => {
  if (initialDetailId && detailId === undefined) detailId = initialDetailId;
});

// Hoisted so the tile selection resolves (validate the persisted ids, scan the catalog) once per
// real change instead of once per clock tick: both the effect below and the template read this.
const tiles = $derived(controller.tiles);
const detailDef = $derived(detailId ? tiles.find((def) => def.id === detailId) : undefined);
const expandedDef = $derived(expandedId ? tiles.find((def) => def.id === expandedId) : undefined);

function spansWholeRow(kind: string, state: string): boolean {
  return kind === 'wind-rose' || (state !== 'never' && (kind === 'wind' || kind === 'position'));
}

// Session-only sparkline history: sampled here on the shared reactive clock so the buffers only
// accumulate while the dock is mounted, matching the subscription lifecycle. The reads are
// untracked so the effect re-runs on the 1 Hz clock and selection changes, not on every delta
// flush; the 5 s sample spacing makes up to a second of staleness invisible.
const history = createTileHistory();
$effect(() => {
  const now = deps.clock.now;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set, never rendered
  const liveIds = new Set<string>();
  for (const def of tiles) {
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
</script>

{#snippet fixedLockAction()}
  {#if lockAction}
    <div class="instrument-lock-action">
      {@render lockAction()}
    </div>
  {/if}
{/snippet}

<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is dialog exactly when aria-modal is defined. -->
<aside
  class="instruments"
  class:instrument-focus={expandedDef !== undefined}
  role={fullscreen ? 'dialog' : undefined}
  aria-label="Instruments"
  aria-modal={fullscreen ? 'true' : undefined}
  tabindex="-1"
  use:dialog={() => controller.setOpen(false)}
  use:trapFocus={fullscreen && expandedDef === undefined}
>
  {#if !fullscreen}
    <InstrumentDockResize width={dockWidth} onResize={onDockResize} onCommit={onDockResizeCommit} />
  {/if}
  <PanelHeader
    title="Instruments"
    closeLabel={fullscreen ? 'Close instruments, return to chart' : 'Close instruments dock'}
    onClose={() => controller.setOpen(false)}
  >
    {#snippet headerExtra()}
      {#if fullscreen && emergencyAction}
        {@render emergencyAction()}
      {/if}
      <CustomizeToggle
        object="instruments"
        editing={customizing}
        compact
        iconOnly
        onToggle={() => {
          detailId = undefined;
          customizing = !customizing;
        }}
      />
    {/snippet}
  </PanelHeader>
  {#if fullscreen && !expandedDef}
    {@render fixedLockAction()}
  {/if}
  {#if detailDef}
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
    <InstrumentsCustomize {controller} {deps} />
  {:else}
    <div class="tiles">
      {#if tiles.length === 0}
        <p class="muted-note empty">No instruments shown. Use Customize to add one.</p>
      {/if}
      {#each tiles as def (def.id)}
        {@const reading = def.read(deps)}
        {@const zone = controller.zoneState(def, reading.siValue)}
        {@const staleAge = staleAgeText(deps, def, reading)}
        {@const depthZone =
          def.kind === 'wind-rose' && depthDef && reading.windRose
            ? controller.zoneState(depthDef, reading.windRose.depth.siValue)
            : 'normal'}
        {@const resolvedLabel = controller.resolvedLabel(def)}
        <div class="tile-shell" class:tile-shell--wide={spansWholeRow(def.kind, reading.state)}>
          <InstrumentTile
            {def}
            label={resolvedLabel}
            {reading}
            {zone}
            {depthZone}
            staleAgeText={staleAge}
            sparkPoints={def.viz === 'spark' ? history.series(def.id) : undefined}
            onActivate={() => (expandedId = def.id)}
          />
          <button
            type="button"
            class="tile-info"
            aria-label={`Show information for ${resolvedLabel}`}
            title={`Show information for ${resolvedLabel}`}
            onclick={() => (detailId = def.id)}
          >
            <CircleHelp size={15} aria-hidden="true" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if expandedDef}
    {@const reading = expandedDef.read(deps)}
    {@const zone = controller.zoneState(expandedDef, reading.siValue)}
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
    >
      <InstrumentTile
        def={expandedDef}
        label={controller.resolvedLabel(expandedDef)}
        {reading}
        {zone}
        {depthZone}
        staleAgeText={staleAge}
        sparkPoints={expandedDef.viz === 'spark' ? history.series(expandedDef.id) : undefined}
        expanded
        onActivate={() => (expandedId = undefined)}
      />
      {@render fixedLockAction()}
    </div>
  {/if}
</aside>

<style>
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
  grid-auto-rows: minmax(min-content, 1fr);
  gap: var(--space-2);
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
}
.tile-shell {
  position: relative;
  display: flex;
  min-inline-size: 0;
}
.tile-shell--wide {
  grid-column: 1 / -1;
}
.tile-shell :global(.tile) {
  flex: 1;
  inline-size: 100%;
}
/* The question mark is visually quiet, but its transparent target keeps the full 44 px touch
   contract. It is a sibling of the tile button, never a nested interactive control. */
.tile-info {
  appearance: none;
  position: absolute;
  inset-inline-end: 0;
  inset-block-end: 0;
  display: grid;
  place-items: center;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: help;
}
.tile-info:hover,
.tile-info:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
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
</style>

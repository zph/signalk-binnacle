<script lang="ts">
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { formatBearingOr, formatMetersOrNm } from '$shared/lib';
import { MAX_NAV_ROWS, type NavSortState, toggleSort } from '$shared/nav';
import {
  createPanelMinimize,
  NavSortControl,
  SearchInput,
  ShowOnChartToggle,
  SlideOver,
} from '$shared/ui';
import { defaultSort, filterRows, type MooringSort, sortRows, toRows } from './mooring-rows';
import { MOORINGS_MIN_ZOOM } from './moorings-layers';
import type { MooringPoint, MooringViewState } from './moorings-types';

interface Props {
  moorings: readonly MooringPoint[];
  vessel: OwnVessel;
  units: UnitsStore;
  viewState: MooringViewState;
  selectedId?: string;
  shown: boolean;
  onToggleShown: (shown: boolean) => void;
  onSelect: (mooring: MooringPoint) => void;
  onLocate: (mooring: MooringPoint) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  moorings,
  vessel,
  units,
  viewState,
  selectedId,
  shown,
  onToggleShown,
  onSelect,
  onLocate,
  onClose,
  onBack,
}: Props = $props();

let query = $state('');
let sortState = $state<NavSortState<MooringSort>>(defaultSort(false));
let sortTouched = $state(false);
const minimize = createPanelMinimize();
const vesselPosition = $derived(vessel.coarsePosition);
const allRows = $derived(
  sortRows(filterRows(toRows(moorings, vesselPosition), query), sortState.key, sortState.dir),
);
const rows = $derived(allRows.slice(0, MAX_NAV_ROWS));
const likelyCount = $derived(
  moorings.filter((mooring) => mooring.assessment.status === 'likely-occupied').length,
);
const possibleCount = $derived(
  moorings.filter((mooring) => mooring.assessment.status === 'possible').length,
);
const subtitle = $derived(
  `${moorings.length} in view · ${likelyCount} likely · ${possibleCount} possible`,
);

const SORTS: { key: MooringSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'AIS clue' },
  { key: 'distance', label: 'Distance' },
  { key: 'bearing', label: 'Bearing' },
];

function chooseSort(key: MooringSort): void {
  sortTouched = true;
  sortState = toggleSort(sortState, key);
}

function occupancyLabel(mooring: MooringPoint): string {
  if (mooring.assessment.status === 'likely-occupied') return 'Likely occupied';
  if (mooring.assessment.status === 'possible') return 'Possible occupancy';
  return 'Unknown';
}

function cacheAge(savedAtMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - savedAtMs) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

$effect(() => {
  if (sortTouched) return;
  const next = defaultSort(vesselPosition !== undefined);
  if (sortState.key !== next.key || sortState.dir !== next.dir) sortState = next;
});
</script>

<SlideOver
  title="Moorings"
  {subtitle}
  {onClose}
  {onBack}
  closeLabel="Close moorings"
  bodyFlex
  {minimize}
>
  <p class="muted-note">
    NOAA ENC charted mooring facilities in the current chart view. AIS clues are advisory. Unknown
    never means vacant, and boats without AIS are not observed.
  </p>
  <ShowOnChartToggle
    visible={shown}
    label="Show moorings on chart"
    description="Charted positions colored by AIS observation"
    onToggle={onToggleShown}
  />
  {#if viewState.cachedAtMs !== undefined}
    <p class={viewState.phase === 'error' ? 'alert-note' : 'muted-note'} role="status">
      Showing saved charted positions from {cacheAge(viewState.cachedAtMs)}.
      {viewState.phase === 'loading'
        ? 'Refreshing the live source now.'
        : viewState.phase === 'error'
          ? 'The live source could not refresh.'
          : 'NOAA refreshes automatically when this snapshot ages.'}
    </p>
  {/if}
  {#if viewState.destinationAis === 'unavailable'}
    <p class="muted-note" role="status">
      Remote-area AIS needs the extended signalk-aisstream plugin. Onboard Signal K AIS still
      contributes when it covers this chart area.
    </p>
  {:else if viewState.destinationAis === 'connecting' || viewState.destinationAis === 'checking'}
    <p class="muted-note" role="status">Connecting the destination-area AIS review feed…</p>
  {:else if viewState.destinationAis === 'disconnected' || viewState.destinationAis === 'error'}
    <p class="alert-note" role="alert">
      Destination AIS is unavailable right now. Mooring positions remain available, with unknown
      occupancy where no current observation exists.
    </p>
  {/if}
  <SearchInput
    bind:value={query}
    placeholder="Search name, category, vessel, or ENC cell"
    ariaLabel="Search moorings by name, category, vessel, or ENC cell"
    clearLabel="Clear the mooring search"
  />
  <NavSortControl
    sorts={SORTS}
    state={sortState}
    onChoose={chooseSort}
    ariaLabel="Sort moorings by"
  />

  {#if rows.length === 0}
    {#if moorings.length > 0}
      <p class="muted-note" role="status">No moorings match your search.</p>
    {:else if viewState.phase === 'zoomed-out'}
      <p class="muted-note" role="status">
        Zoom in to level {MOORINGS_MIN_ZOOM} or closer to review moorings.
      </p>
    {:else if viewState.phase === 'hidden'}
      <p class="muted-note" role="status">Turn on Show moorings on chart to search this area.</p>
    {:else if viewState.phase === 'error'}
      <p class="alert-note" role="alert">Mooring positions could not load. Pan or zoom to retry.</p>
    {:else if viewState.phase === 'loading' || viewState.phase === 'idle'}
      <p class="muted-note" role="status">Loading moorings for this chart view…</p>
    {:else}
      <p class="muted-note" role="status">
        No NOAA ENC mooring facilities were found in this view.
      </p>
    {/if}
  {:else}
    <ul class="nav-list bare-list" aria-label="Moorings in view">
      {#each rows as row (row.mooring.id)}
        <li
          class="nav-row mooring-card"
          aria-current={selectedId === row.mooring.id ? 'true' : undefined}
        >
          <button
            type="button"
            class="mooring-summary"
            aria-expanded={selectedId === row.mooring.id}
            onclick={() => onSelect(row.mooring)}
          >
            <span class="mooring-title">
              <span class="nav-name">{row.mooring.name}</span>
              <span class="mooring-source">
                {row.mooring.category ?? 'Mooring facility'}
                {row.mooring.encCell
                  ? ` · ${row.mooring.encCell}`
                  : ''}
              </span>
            </span>
            <span class="nav-metrics">
              <span class="nav-metric occupancy occupancy--{row.mooring.assessment.status}">
                AIS <b>{occupancyLabel(row.mooring)}</b>
              </span>
              <span class="nav-metric">
                Distance <b class="num">{formatMetersOrNm(row.distanceMeters, units.mode)}</b>
              </span>
              <span class="nav-metric">
                Bearing
                <b class="num">
                  {row.bearingRad === undefined ? '--' : `${formatBearingOr(row.bearingRad)}°T`}
                </b>
              </span>
            </span>
          </button>
          {#if selectedId === row.mooring.id}
            <section class="mooring-details" aria-label="Selected mooring details">
              <div class="mooring-detail-head">
                <p>{occupancyLabel(row.mooring)} · score {row.mooring.assessment.score} of 100</p>
                <button type="button" class="btn btn-compact" onclick={() => onLocate(row.mooring)}>
                  <LocateFixed size={16} aria-hidden="true" />
                  Locate
                </button>
              </div>
              {#if row.mooring.information}
                <p>{row.mooring.information}</p>
              {/if}
              {#if row.mooring.assessment.vesselName}
                <p>
                  AIS target: {row.mooring.assessment.vesselName}. Source:
                  {row.mooring.assessment.source ===
                  'destination'
                    ? 'destination review feed'
                    : 'onboard Signal K'}.
                </p>
              {/if}
              {#if row.mooring.assessment.evidence.length > 0}
                <h3 class="caps-label">
                  {row.mooring.assessment.vesselId
                    ? 'AIS evidence'
                    : 'Why no vessel was associated'}
                </h3>
                <ul>
                  {#each row.mooring.assessment.evidence as evidence, index (index)}
                    <li>{evidence}</li>
                  {/each}
                </ul>
              {/if}
              <p class="muted-note">
                NOAA ENC {row.mooring.encCell ?? 'source cell unavailable'}
                {row.mooring.sourceDate
                  ? ` · source date ${row.mooring.sourceDate}`
                  : ''}
              </p>
            </section>
          {/if}
        </li>
      {/each}
    </ul>
    {#if allRows.length > MAX_NAV_ROWS}
      <p class="muted-note" role="status">
        Showing the first {MAX_NAV_ROWS} of {allRows.length} matches. Search or zoom in to narrow
        the results.
      </p>
    {/if}
  {/if}
</SlideOver>

<style>
.mooring-title {
  min-inline-size: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}
.mooring-source {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.occupancy--likely-occupied b {
  color: var(--alarm);
}
.occupancy--possible b {
  color: var(--warning);
}
.mooring-card {
  gap: 0;
  padding: 0;
  cursor: default;
}
.mooring-summary {
  inline-size: 100%;
  min-block-size: var(--control-size);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.mooring-details {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border-block-start: 1px solid var(--border);
}
.mooring-detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.mooring-details p,
.mooring-details ul {
  margin: 0;
}
</style>

<script lang="ts">
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onDestroy, untrack } from 'svelte';
import type {
  NearbyTideStation,
  TideStationKind,
  TideStationSelection,
  TidesStore,
} from '$entities/tides';
import { MAX_NEARBY_STATIONS } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { DEPTH_SOURCE_LABELS } from '$entities/vessel';
import { Clock, formatBearingOr, formatClockTime, formatMonthDay, MINUTE_MS } from '$shared/lib';
import { createPanelMinimize, ShowOnChartToggle, SlideOver } from '$shared/ui';
import type { TidesController } from './tides-controller.svelte';
import {
  formatCurrentRate,
  formatStationDistance,
  formatTideHeight,
  formatTideHeightSecondary,
  nextCurrentEvent,
  nextFlowEvent,
  nowFraction,
  tideCurvePoints,
  tideCurveSamples,
  tideDepthCurvePoints,
  tideHoverReading,
  tideSourceNote,
  upcomingEvents,
} from './tides-display';

interface Props {
  store: TidesStore;
  controller: TidesController;
  units: UnitsStore;
  vessel: OwnVessel;
  // Whether the tide-station layer is shown on the chart; the toggle row only renders when the
  // host wires onToggleStations, so the panel works without the layer.
  stationsShown?: boolean;
  onToggleStations?: (shown: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  store,
  controller,
  units,
  vessel,
  stationsShown = false,
  onToggleStations,
  onClose,
  onBack,
}: Props = $props();

const tide = $derived(store.tide);
const current = $derived(store.current);
const stationDistanceText = $derived(
  tide ? formatStationDistance(tide.distanceMeters, units.mode) : '',
);
const currentStationDistanceText = $derived(
  current ? formatStationDistance(current.distanceMeters, units.mode) : '',
);
// A live clock so "next" events and the now-marker stay current while the panel is open, not frozen
// at the last refresh (a stationary boat may not trigger a reload for hours).
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());

const CURVE_W = 600;
const CURVE_H = 220;
const CURVE_LEFT = 58;
const CURVE_RIGHT = 14;
const CURVE_TOP = 12;
const CURVE_BOTTOM = 30;
const CURVE_PLOT_W = CURVE_W - CURVE_LEFT - CURVE_RIGHT;
const CURVE_PLOT_H = CURVE_H - CURVE_TOP - CURVE_BOTTOM;

const upcoming = $derived(tide ? upcomingEvents(tide.events, clock.now) : []);
const nextHigh = $derived(upcoming.find((event) => event.kind === 'high'));
const nextLow = $derived(upcoming.find((event) => event.kind === 'low'));
const curve = $derived(tide ? normalizedTideCurve(tide.events, tide.samples) : []);
const anchorDepth = $derived(vessel.anchorDepth);
const depthCurve = $derived(
  tide && anchorDepth.meters !== undefined && !anchorDepth.stale
    ? tideDepthCurvePoints(tide.events, clock.now, anchorDepth.meters, tide.samples)
    : undefined,
);
const chartRange = $derived.by(() => {
  if (depthCurve) {
    return { minimum: depthCurve.minimumMeters, maximum: depthCurve.maximumMeters };
  }
  const samples = tide ? (tide.samples?.length ? tide.samples : tideCurveSamples(tide.events)) : [];
  if (samples.length === 0) return undefined;
  let minimum = samples[0].heightMeters;
  let maximum = minimum;
  for (const sample of samples) {
    minimum = Math.min(minimum, sample.heightMeters);
    maximum = Math.max(maximum, sample.heightMeters);
  }
  if (minimum === maximum) maximum = minimum + 1;
  return { minimum, maximum };
});
const verticalTicks = $derived(
  chartRange
    ? Array.from({ length: 5 }, (_, index) => {
        const fraction = index / 4;
        return {
          value: chartRange.minimum + (chartRange.maximum - chartRange.minimum) * fraction,
          y: CURVE_TOP + (1 - fraction) * CURVE_PLOT_H,
        };
      })
    : [],
);
const timeTicks = $derived.by(() => {
  if (!tide || tide.events.length < 2) return [];
  const start = tide.samples?.[0]?.timeMs ?? tide.events[0].timeMs;
  const end = tide.samples?.at(-1)?.timeMs ?? tide.events[tide.events.length - 1].timeMs;
  return Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;
    const timeMs = start + (end - start) * fraction;
    return { fraction, timeMs, x: CURVE_LEFT + fraction * CURVE_PLOT_W };
  });
});
const nowFrac = $derived.by(() => {
  if (!tide) return undefined;
  if (!tide.samples?.length) return nowFraction(tide.events, clock.now);
  const start = tide.samples[0].timeMs;
  const end = tide.samples.at(-1)?.timeMs ?? start;
  return clock.now < start || clock.now > end
    ? undefined
    : (clock.now - start) / (end - start || 1);
});
const nextCurrent = $derived(current ? nextCurrentEvent(current.events, clock.now) : undefined);
// When the soonest event is slack, the following flood or ebb maximum keeps the flow picture.
const followingFlow = $derived(
  current && nextCurrent?.kind === 'slack' ? nextFlowEvent(current.events, clock.now) : undefined,
);
const sourceNote = $derived(tideSourceNote(store.source, store.loadedTide));
const minimize = createPanelMinimize();
let chartNode = $state<SVGSVGElement | undefined>();
let hover = $state<
  | {
      fraction: number;
      timeMs: number;
      tideHeightMeters: number;
      estimatedDepthMeters?: number;
    }
  | undefined
>();
let observedSelectionRevision = untrack(() => store.selectionRevision);
$effect(() => {
  const revision = store.selectionRevision;
  if (revision !== observedSelectionRevision) {
    observedSelectionRevision = revision;
    minimize.expand();
  }
});

// The rate and set as one string, so no stray whitespace creeps in between the rate and the comma.
const currentRate = $derived.by(() => {
  if (!nextCurrent) return '';
  const dirSuffix =
    nextCurrent.directionRad !== undefined
      ? `, ${formatBearingOr(nextCurrent.directionRad, 0)}°`
      : '';
  return `${formatCurrentRate(nextCurrent.velocityMps)}${dirSuffix}`;
});

// Keep a manual off-catalog selection visible without exceeding the eight-row panel bound.
function choices(
  nearby: NearbyTideStation[],
  requested: TideStationSelection,
): NearbyTideStation[] {
  const candidates =
    requested.mode === 'automatic'
      ? nearby
      : [{ station: requested.station, distanceMeters: requested.distanceMeters }, ...nearby];
  const unique: NearbyTideStation[] = [];
  for (const candidate of candidates) {
    if (unique.some((existing) => existing.station.id === candidate.station.id)) continue;
    unique.push(candidate);
    if (unique.length >= MAX_NEARBY_STATIONS) break;
  }
  return unique;
}

const tideChoices = $derived(choices(store.nearbyTideStations, store.requestedTide));
const currentChoices = $derived(choices(store.nearbyCurrentStations, store.requestedCurrent));
// An empty candidate list only means "nothing nearby" once a search actually finished. Before one
// starts, while one runs, or after one fails, the list is empty for a reason that has nothing to do
// with the water, and claiming no stations exist there would be a false statement about coverage.
const stationsSearched = $derived(store.status === 'ready' || store.status === 'no-coverage');

function isSelected(selection: TideStationSelection, stationId?: string): boolean {
  if (stationId === undefined) return selection.mode === 'automatic';
  return selection.mode === 'manual' && selection.station.id === stationId;
}

function selectionFailure(kind: TideStationKind): string {
  const failure = store.failure(kind);
  if (!failure) return '';
  const loaded = store.reading(kind);
  const subject =
    failure.requested.mode === 'manual'
      ? failure.requested.station.name
      : `The automatic ${kind === 'tide' ? 'tide' : 'current'} station`;
  return loaded
    ? `${subject} did not load. Showing the last accepted reading from ${loaded.station.name}.`
    : `${subject} did not load. Check the connection and retry.`;
}

function select(kind: TideStationKind, candidate: NearbyTideStation): void {
  void controller.selectStation(kind, candidate.station);
}

// A smooth path through the day's high and low turning points: a quadratic that rounds each corner
// so the rise and fall read as a tide curve rather than a sawtooth.
function curvePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const px = (point: { x: number; y: number }) => CURVE_LEFT + point.x * CURVE_PLOT_W;
  const py = (point: { x: number; y: number }) => (1 - point.y) * CURVE_PLOT_H + CURVE_TOP;
  let d = `M ${px(points[0]).toFixed(1)} ${py(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const currentPoint = points[i];
    const middleX = (px(previous) + px(currentPoint)) / 2;
    const middleY = (py(previous) + py(currentPoint)) / 2;
    d += ` Q ${px(previous).toFixed(1)} ${py(previous).toFixed(1)} ${middleX.toFixed(1)} ${middleY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${px(last).toFixed(1)} ${py(last).toFixed(1)}`;
  return d;
}

function normalizedTideCurve(
  events: import('$entities/tides').TideEvent[],
  detailedSamples?: import('$entities/tides').TideSample[],
) {
  const samples = detailedSamples?.length ? detailedSamples : tideCurveSamples(events);
  if (samples.length === 0) return tideCurvePoints(events);
  let minimum = samples[0].heightMeters;
  let maximum = minimum;
  for (const sample of samples) {
    minimum = Math.min(minimum, sample.heightMeters);
    maximum = Math.max(maximum, sample.heightMeters);
  }
  const start = samples[0].timeMs;
  const span = samples[samples.length - 1].timeMs - start || 1;
  const heightSpan = maximum - minimum || 1;
  return samples.map((sample) => ({
    x: (sample.timeMs - start) / span,
    y: (sample.heightMeters - minimum) / heightSpan,
  }));
}

function chartY(value: number): number {
  if (!chartRange) return CURVE_TOP + CURVE_PLOT_H / 2;
  const fraction = (value - chartRange.minimum) / (chartRange.maximum - chartRange.minimum || 1);
  return CURVE_TOP + (1 - fraction) * CURVE_PLOT_H;
}

function showHoverAt(fraction: number): void {
  if (!tide || tide.events.length < 2) return;
  const bounded = Math.max(0, Math.min(1, fraction));
  const start = tide.samples?.[0]?.timeMs ?? tide.events[0].timeMs;
  const end = tide.samples?.at(-1)?.timeMs ?? tide.events[tide.events.length - 1].timeMs;
  const reading = tideHoverReading(
    tide.events,
    start + (end - start) * bounded,
    anchorDepth.meters,
    clock.now,
    tide.samples,
  );
  hover = reading ? { fraction: bounded, ...reading } : undefined;
}

function onChartPointerMove(event: PointerEvent): void {
  if (!chartNode) return;
  const bounds = chartNode.getBoundingClientRect();
  const chartX = ((event.clientX - bounds.left) / bounds.width) * CURVE_W;
  showHoverAt((chartX - CURVE_LEFT) / CURVE_PLOT_W);
}

function onChartKeydown(event: KeyboardEvent): void {
  if (!tide || tide.events.length < 2) return;
  if (event.key === 'Home') showHoverAt(0);
  else if (event.key === 'End') showHoverAt(1);
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const start = tide.samples?.[0]?.timeMs ?? tide.events[0].timeMs;
    const end = tide.samples?.at(-1)?.timeMs ?? tide.events[tide.events.length - 1].timeMs;
    const span = end - start;
    const step = ((event.shiftKey ? 60 : 6) * MINUTE_MS) / (span || 1);
    showHoverAt((hover?.fraction ?? nowFrac ?? 0.5) + (event.key === 'ArrowLeft' ? -step : step));
  } else return;
  event.preventDefault();
}
</script>

<SlideOver
  title="Tide station settings"
  closeLabel="Close tides panel"
  {onClose}
  {onBack}
  bodyFlex
  {minimize}
>
  <p class="muted-note">
    Automatic mode finds nearby stations. Manual choices use NOAA CO-OPS and stay selected while you
    pan.
  </p>
  <p class="muted-note">
    Distances are straight-line from the chart center and do not guarantee that a station represents
    local water movement.
  </p>

  {#if onToggleStations}
    <ShowOnChartToggle
      visible={stationsShown}
      label="Show stations on chart"
      description="Filled tide markers and hollow current markers you can tap for predictions."
      onToggle={onToggleStations}
    />
  {/if}

  <section class="panel-section selection" aria-label="Station selection">
    <div class="section-head">
      <h3 class="caps-label">Station selection</h3>
      <button
        type="button"
        class="btn btn-ghost nearest"
        onclick={() => void controller.useNearestStations()}
      >
        Use nearest stations
      </button>
    </div>

    <div class="station-group" role="group" aria-labelledby="tide-stations-heading">
      <h4 class="caps-label" id="tide-stations-heading">Tide stations</h4>
      <button
        type="button"
        class="nav-row"
        aria-current={isSelected(store.requestedTide) ? 'true' : undefined}
        onclick={() => void controller.useAutomatic('tide')}
      >
        <span class="nav-name">Automatic, nearest available</span>
        <span class="nav-metrics">Prefers signalk-tides when available</span>
      </button>
      {#each tideChoices as candidate (`tide:${candidate.station.id}`)}
        <button
          type="button"
          class="nav-row"
          aria-current={isSelected(store.requestedTide, candidate.station.id) ? 'true' : undefined}
          onclick={() => select('tide', candidate)}
        >
          <span class="nav-name">{candidate.station.name}</span>
          <span class="nav-metrics">
            {formatStationDistance(candidate.distanceMeters, units.mode)}
            straight-line
          </span>
        </button>
      {/each}
      {#if tideChoices.length === 0 && stationsSearched}
        <p class="muted-note">No NOAA tide stations are within 100 km of the chart center.</p>
      {/if}
    </div>

    <div class="station-group" role="group" aria-labelledby="current-stations-heading">
      <h4 class="caps-label" id="current-stations-heading">Current stations</h4>
      <button
        type="button"
        class="nav-row"
        aria-current={isSelected(store.requestedCurrent) ? 'true' : undefined}
        onclick={() => void controller.useAutomatic('current')}
      >
        <span class="nav-name">Automatic, nearest available</span>
        <span class="nav-metrics">Searches nearby NOAA CO-OPS stations</span>
      </button>
      {#each currentChoices as candidate (`current:${candidate.station.id}`)}
        <button
          type="button"
          class="nav-row"
          aria-current={isSelected(store.requestedCurrent, candidate.station.id) ? 'true' : undefined}
          onclick={() => select('current', candidate)}
        >
          <span class="nav-name">{candidate.station.name}</span>
          <span class="nav-metrics">
            {formatStationDistance(candidate.distanceMeters, units.mode)}
            straight-line
          </span>
        </button>
      {/each}
      {#if currentChoices.length === 0 && stationsSearched}
        <p class="muted-note">No NOAA current stations are within 60 km of the chart center.</p>
      {/if}
    </div>
  </section>

  {#if !tide && store.status === 'loading'}
    <p class="muted-note" role="status">Finding tide and current stations…</p>
  {:else if store.status === 'no-coverage'}
    <p class="muted-note" role="status">
      No tide station nearby. NOAA tide predictions cover US waters only.
    </p>
  {:else if tide}
    <section class="panel-section reading" aria-label="Tide prediction">
      <h3 class="caps-label">Tide prediction</h3>
      <div class="station">
        <span class="name" title={tide.station.name}>{tide.station.name}</span>
        <span class="dist caps-label">{stationDistanceText} away</span>
      </div>

      {#if tide.events.length === 0}
        <p class="muted-note" role="status">No predictions in this window.</p>
      {:else}
        <dl class="stat-grid">
          <dt>Next high</dt>
          <dd>
            {#if nextHigh}
              <span class="num"
                >{formatClockTime(nextHigh.timeMs)},
                {formatTideHeight(
                  nextHigh.heightMeters,
                  units.mode,
                )}</span
              >
              <span class="unit">
                {formatTideHeightSecondary(nextHigh.heightMeters, units.mode)}
              </span>
            {:else}
              <span class="num">--</span><span class="unit"></span>
            {/if}
          </dd>
          <dt>Next low</dt>
          <dd>
            {#if nextLow}
              <span class="num"
                >{formatClockTime(nextLow.timeMs)},
                {formatTideHeight(
                  nextLow.heightMeters,
                  units.mode,
                )}</span
              >
              <span class="unit">
                {formatTideHeightSecondary(nextLow.heightMeters, units.mode)}
              </span>
            {:else}
              <span class="num">--</span><span class="unit"></span>
            {/if}
          </dd>
        </dl>
      {/if}

      {#if curve.length > 1}
        <div class="curve-wrap">
          <!-- The graph restates the numeric prediction and its legend immediately below, so it is
               decorative for assistive technology. -->
          <div
            class="chart-interactive"
            role="slider"
            aria-label="Interactive tide chart. Use the pointer, or the left and right arrow keys, to inspect predicted tide height and estimated depth."
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round((hover?.fraction ?? nowFrac ?? 0.5) * 100)}
            aria-valuetext={hover
              ? `${formatMonthDay(hover.timeMs)} ${formatClockTime(hover.timeMs)}, tide ${formatTideHeight(hover.tideHeightMeters, units.mode)}${hover.estimatedDepthMeters !== undefined ? `, estimated depth ${formatTideHeight(hover.estimatedDepthMeters, units.mode)}` : ''}`
              : 'Move through the tide prediction'}
            tabindex="0"
            onpointermove={onChartPointerMove}
            onpointerleave={() => (hover = undefined)}
            onfocus={() => showHoverAt(nowFrac ?? 0.5)}
            onblur={() => (hover = undefined)}
            onkeydown={onChartKeydown}
          >
            <svg
              bind:this={chartNode}
              class="curve"
              viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
              aria-hidden="true"
            >
              {#each verticalTicks as tick (tick.value)}
                <line
                  class="grid-line"
                  x1={CURVE_LEFT}
                  x2={CURVE_W - CURVE_RIGHT}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text class="axis-label" x={CURVE_LEFT - 7} y={tick.y + 4} text-anchor="end">
                  {formatTideHeight(tick.value, units.mode)}
                </text>
              {/each}
              {#each timeTicks as tick (tick.timeMs)}
                <line
                  class="grid-line grid-line--vertical"
                  x1={tick.x}
                  x2={tick.x}
                  y1={CURVE_TOP}
                  y2={CURVE_H - CURVE_BOTTOM}
                />
                <text class="axis-label time-label" x={tick.x} y={CURVE_H - 8} text-anchor="middle">
                  {formatClockTime(tick.timeMs)}
                </text>
              {/each}
              <path
                class="curve-line tide-line"
                d={curvePath(depthCurve?.tide ?? curve)}
                fill="none"
              />
              {#if depthCurve}
                <path
                  class="curve-line depth-line"
                  d={curvePath(depthCurve.estimatedDepth)}
                  fill="none"
                />
              {/if}
              {#if nowFrac !== undefined}
                <line
                  class="now"
                  x1={CURVE_LEFT + nowFrac * CURVE_PLOT_W}
                  y1={CURVE_TOP}
                  x2={CURVE_LEFT + nowFrac * CURVE_PLOT_W}
                  y2={CURVE_H - CURVE_BOTTOM}
                />
              {/if}
              {#if hover}
                {@const hoverX = CURVE_LEFT + hover.fraction * CURVE_PLOT_W}
                <line
                  class="hover-line"
                  x1={hoverX}
                  x2={hoverX}
                  y1={CURVE_TOP}
                  y2={CURVE_H - CURVE_BOTTOM}
                />
                <circle
                  class="hover-point hover-point--tide"
                  cx={hoverX}
                  cy={chartY(hover.tideHeightMeters)}
                  r="4"
                />
                {#if hover.estimatedDepthMeters !== undefined}
                  <circle
                    class="hover-point hover-point--depth"
                    cx={hoverX}
                    cy={chartY(hover.estimatedDepthMeters)}
                    r="4"
                  />
                {/if}
              {/if}
            </svg>
            {#if hover}
              <div
                class="chart-tooltip"
                style={`--hover-x: ${hover.fraction * 100}%`}
                role="status"
              >
                <strong>{formatMonthDay(hover.timeMs)} · {formatClockTime(hover.timeMs)}</strong>
                <span>Tide {formatTideHeight(hover.tideHeightMeters, units.mode)}</span>
                {#if hover.estimatedDepthMeters !== undefined}
                  <span>
                    Estimated depth {formatTideHeight(hover.estimatedDepthMeters, units.mode)}
                  </span>
                {/if}
              </div>
            {/if}
          </div>
          <div class="curve-legend">
            <span><i class="legend-line tide-legend"></i>Tide height</span>
            {#if depthCurve && anchorDepth.source}
              <span>
                <i class="legend-line depth-legend"></i>Estimated depth,
                {DEPTH_SOURCE_LABELS[anchorDepth.source]}
                sounder plus predicted tide change
              </span>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <section class="panel-section current" aria-label="Tidal current prediction">
      <h3 class="caps-label">Tidal current</h3>
      {#if current}
        <div class="station">
          <span class="name" title={current.station.name}>{current.station.name}</span>
          <span class="dist caps-label">{currentStationDistanceText} away</span>
        </div>
        {#if current.events.length === 0}
          <p class="muted-note" role="status">No predictions in this window.</p>
        {:else}
          <dl class="stat-grid">
            <dt>
              {nextCurrent
                ? `Next ${nextCurrent.kind}`
                : 'Next current'}
            </dt>
            <dd>
              {#if nextCurrent}
                <span class="num">{formatClockTime(nextCurrent.timeMs)}, {currentRate}</span>
                <span class="unit"></span>
              {:else}
                <span class="num">--</span><span class="unit"></span>
              {/if}
            </dd>
            {#if followingFlow}
              <dt>{`Then ${followingFlow.kind}`}</dt>
              <dd>
                <span class="num"
                  >{formatClockTime(followingFlow.timeMs)},
                  {formatCurrentRate(
                    followingFlow.velocityMps,
                  )}{followingFlow.directionRad !== undefined
                    ? `, ${formatBearingOr(followingFlow.directionRad, 0)}°`
                    : ''}</span
                >
                <span class="unit"></span>
              </dd>
            {/if}
          </dl>
        {/if}
        <p class="footnote">Ebb flows out toward the sea, and flood flows in from it.</p>
      {:else}
        <p class="muted-note">No tidal-current prediction is available for the selected mode.</p>
      {/if}
    </section>

    {#if selectionFailure('tide') || selectionFailure('current')}
      <div class="refresh-note" role="alert">
        <div>
          {#if selectionFailure('tide')}
            <p class="alert-note">{selectionFailure('tide')}</p>
          {/if}
          {#if selectionFailure('current')}
            <p class="alert-note">{selectionFailure('current')}</p>
          {/if}
        </div>
        <button type="button" class="btn" onclick={() => void controller.retry()}>
          <RefreshCw size={16} aria-hidden="true" />
          Retry
        </button>
      </div>
    {:else if store.status === 'loading'}
      <p class="muted-note" role="status">Refreshing selected tide and current stations…</p>
    {/if}

    {#if sourceNote}
      <p class="muted-note source-note">{sourceNote}</p>
    {/if}
    <p class="footnote">
      Heights are above mean lower low water (MLLW), the chart's zero. Times are in the device's
      local time.
    </p>
    <p class="footnote">
      {#if tide.samples?.length}
        Chart inspection uses NOAA's six-minute predictions.
      {:else}
        The curve between reported high and low events is an advisory estimate.
      {/if}
    </p>
    {#if depthCurve}
      <p class="footnote">
        Estimated depth adjusts the current sounder reading by the station's predicted tide change.
        It is advisory and does not account for local bathymetry, waves, squat, or distance from the
        station.
      </p>
    {/if}
  {:else if store.status === 'error'}
    <div class="refresh-note" role="alert">
      <div>
        {#if selectionFailure('tide')}
          <p class="alert-note">{selectionFailure('tide')}</p>
        {:else}
          <p class="alert-note">Could not load tide predictions. Check the connection.</p>
        {/if}
        {#if selectionFailure('current')}
          <p class="alert-note">{selectionFailure('current')}</p>
        {/if}
      </div>
      <button type="button" class="btn" onclick={() => void controller.retry()}>
        <RefreshCw size={16} aria-hidden="true" />
        Retry
      </button>
    </div>
  {:else}
    <p class="muted-note" role="status">Pan to a US coast to see tide predictions.</p>
  {/if}
</SlideOver>

<style>
.selection,
.station-group,
.reading,
.current {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.section-head > .caps-label {
  margin: 0;
}
.nearest {
  min-block-size: var(--control-size);
}
.station-group {
  padding-block-start: var(--space-1);
}
.station-group + .station-group,
.reading,
.current {
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--border);
}
.station-group > .caps-label,
.reading > .caps-label,
.current > .caps-label {
  margin: 0;
}
.station {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.dist {
  flex-shrink: 0;
  color: var(--text-muted);
}
.curve {
  inline-size: 100%;
  block-size: clamp(12rem, 30vh, 16rem);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.chart-interactive {
  position: relative;
  min-inline-size: 0;
  border-radius: var(--radius-sm);
  outline: none;
}
.grid-line {
  stroke: color-mix(in srgb, var(--border) 70%, transparent);
  stroke-width: 1;
}
.grid-line--vertical {
  opacity: 0.65;
}
.axis-label {
  fill: var(--text-muted);
  font-family: var(--font-ui);
  font-size: 10px;
}
.time-label {
  font-variant-numeric: tabular-nums;
}
.curve-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.curve-line {
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tide-line,
.tide-legend {
  stroke: var(--accent);
  background: var(--accent);
}
.depth-line {
  stroke: var(--text);
  stroke-dasharray: 5 3;
}
.depth-legend {
  background: var(--text);
}
.curve-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.curve-legend > span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.legend-line {
  display: inline-block;
  inline-size: 1.25rem;
  block-size: 2px;
  border-radius: 999px;
}
.now {
  stroke: var(--text-muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.hover-line {
  stroke: var(--text);
  stroke-width: 1;
  stroke-dasharray: 2 2;
  opacity: 0.8;
}
.hover-point {
  stroke: var(--surface);
  stroke-width: 2;
}
.hover-point--tide {
  fill: var(--accent);
}
.hover-point--depth {
  fill: var(--text);
}
.chart-tooltip {
  position: absolute;
  z-index: 1;
  inset-block-start: var(--space-2);
  inset-inline-start: clamp(5.5rem, var(--hover-x), calc(100% - 5.5rem));
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-inline-size: 9.5rem;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
  color: var(--text);
  font-size: var(--text-xs);
  pointer-events: none;
  transform: translateX(-50%);
}
.chart-tooltip strong {
  font-variant-numeric: tabular-nums;
}
.refresh-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.refresh-note > div {
  display: flex;
  flex: 1 1 14rem;
  flex-direction: column;
  gap: var(--space-1);
}
.refresh-note p {
  margin: 0;
}
/* The provenance note sits with the footnote, so it drops to the same fine-print scale. */
.source-note {
  font-size: var(--text-xs);
}
.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>

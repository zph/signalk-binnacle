<script lang="ts">
// Sail Wayfinder panel: captures a passage from the chart or a saved route, then weather-routes it
// without activating it.

import Compass from '@lucide/svelte/icons/compass';
import LoaderCircle from '@lucide/svelte/icons/loader-circle';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onMount, untrack } from 'svelte';
import type { Route, RouteStore } from '$entities/route';
import { depthValueFromMeters, depthValueToMeters, type UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { LatLon } from '$shared/geo';
import { formatDuration, formatLatitude, formatLongitude, PLACEHOLDER } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import { createPanelMinimize, LayerToggle, SlideOver, UnitField } from '$shared/ui';
import type { WayfinderObjective } from './wayfinder-client';
import { buildWayfinderLegRows } from './wayfinder-route-table';
import type { createWayfindingController } from './wayfinding-controller.svelte';

interface Props {
  controller: ReturnType<typeof createWayfindingController>;
  routeStore: RouteStore;
  vessel: OwnVessel;
  units: UnitsStore;
  chartCommands?: {
    getCenter: () => LatLon;
  };
  onChartModeChange?: (active: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  controller,
  routeStore,
  vessel,
  units,
  chartCommands,
  onChartModeChange,
  onClose,
  onBack,
}: Props = $props();
const minimize = createPanelMinimize();
const supportsPassageConstraints = $derived(
  controller.capabilities?.passageConstraints.includes('daylightOnly') === true &&
    controller.capabilities?.passageConstraints.includes('maxHoursPerDay') === true,
);
const supportsShoreConstraints = $derived(
  controller.capabilities?.navigationConstraints.includes('minimumShoreDistanceNm') === true &&
    controller.capabilities?.navigationConstraints.includes('maximumOffshoreDistanceNm') === true,
);
const supportsAlternatives = $derived((controller.capabilities?.maximumAlternatives ?? 0) > 0);
const available = $derived(
  controller.capabilities?.ready === true &&
    supportsPassageConstraints &&
    supportsShoreConstraints &&
    supportsAlternatives,
);

function formatDownloadElapsed(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  if (wholeSeconds < 60) return `${wholeSeconds} sec`;

  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes} min ${wholeSeconds % 60} sec`;
}
const reason = $derived(
  controller.error ??
    (controller.capabilities?.ready &&
    (!supportsPassageConstraints || !supportsShoreConstraints || !supportsAlternatives)
      ? 'Update Sail Wayfinder to use passage alternatives and navigation constraints.'
      : undefined) ??
    controller.capabilities?.unavailableReason ??
    'Install and configure Sail Wayfinder with forecast coverage, a polar, and shoreline data.',
);
let routeId = $state('');
let passageSource = $state<'chart' | 'saved'>('chart');
let startPosition = $state<LatLon | undefined>();
let destinationPosition = $state<LatLon | undefined>();
let startInitialized = false;
let departure = $state(new Date(Date.now() + 300_000).toISOString().slice(0, 16));
let daylightOnly = $state(false);
let maxHoursPerDay = $state(0);
let minimumShoreDistanceNm = $state(0.5);
let maximumOffshoreDistanceNm = $state(0);
let objective = $state<WayfinderObjective>('fastest');
let alternativeCount = $state(5);
let motorSpeedKn = $state(0);
let motorBelowKn = $state(0);
let useCurrentGrib = $state(true);
let waitForWind = $state(false);
let maxWindKn = $state(0);
let maxWaveM = $state(0);
let vesselDraftM = $state(0);
let draftPath = $state('design.draft.current');
let saveName = $state('');
const selectedSavedRoute = $derived(routeStore.routeById(routeId));
const chartRoute = $derived.by<Route | undefined>(() => {
  if (!startPosition || !destinationPosition) return undefined;
  return {
    id: 'wayfinder-chart-passage',
    name: 'Chart passage',
    waypoints: [
      { name: 'Start', position: startPosition },
      { name: 'Destination', position: destinationPosition },
    ],
  };
});
const selected = $derived(passageSource === 'chart' ? chartRoute : selectedSavedRoute);
const directDistanceNm = $derived(
  startPosition && destinationPosition
    ? haversineMeters(
        startPosition.latitude,
        startPosition.longitude,
        destinationPosition.latitude,
        destinationPosition.longitude,
      ) / 1852
    : undefined,
);
const canChooseWaitForWind = $derived(
  objective === 'bestWeather' ||
    (objective === 'fastest' && !(motorSpeedKn > 0 && motorBelowKn > 0)),
);
const selectedRouteGeometry = $derived(
  controller.routes.find((route) => route.index === controller.selectedAlternativeIndex),
);
const selectedLegRows = $derived(buildWayfinderLegRows(selectedRouteGeometry?.points ?? []));
const selectedTackCount = $derived(selectedLegRows.filter((row) => row.maneuver === 'Tack').length);
const selectedJibeCount = $derived(selectedLegRows.filter((row) => row.maneuver === 'Jibe').length);
const routeTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatRouteTime(timeMs: number | undefined): string {
  return timeMs === undefined ? PLACEHOLDER : routeTimeFormatter.format(timeMs);
}

onMount(() => {
  if (!routeId && routeStore.routes[0]) routeId = routeStore.routes[0].id;
  void controller.refresh().then(() => applyDiscoveredDraft());
});

$effect(() => {
  const position = vessel.position;
  if (startInitialized || !position || vessel.positionStale) return;
  startPosition = position;
  startInitialized = true;
});

$effect(() => {
  onChartModeChange?.(passageSource === 'chart');
  return () => onChartModeChange?.(false);
});

$effect(() => {
  const route = selected;
  untrack(() => controller.preview(route));
});

function setEndpointFromChart(endpoint: 'start' | 'destination'): void {
  const center = chartCommands?.getCenter();
  if (!center) return;
  if (endpoint === 'start') {
    startPosition = center;
    startInitialized = true;
  } else destinationPosition = center;
}

function useVesselStart(): void {
  if (!vessel.position || vessel.positionStale) return;
  startPosition = vessel.position;
  startInitialized = true;
}

function applyDiscoveredDraft(): void {
  const capabilities = controller.capabilities;
  if (!capabilities) return;
  draftPath = capabilities.configuredDraftPath;
  vesselDraftM = capabilities.vesselDraft?.valueM ?? 0;
  alternativeCount = Math.min(5, capabilities.maximumAlternatives);
}

async function readDraftPath(): Promise<void> {
  await controller.refresh(draftPath.trim());
  vesselDraftM = controller.capabilities?.vesselDraft?.valueM ?? 0;
}

function calculate(): void {
  if (!selected || !departure) return;
  saveName =
    passageSource === 'chart' ? 'Wayfinder chart passage' : `${selected.name} weather route`;
  void controller.plan(selected, new Date(departure).toISOString(), {
    daylightOnly,
    maxHoursPerDay,
    minimumShoreDistanceNm,
    maximumOffshoreDistanceNm,
    objective,
    alternativeCount,
    motorSpeedKn,
    motorBelowKn,
    useLandAvoidance: true,
    useCurrentGrib,
    waitForWind,
    maxWindKn,
    maxWaveM,
    vesselDraftM,
  });
}

const objectiveLabel = $derived(
  objective === 'leastMotoring'
    ? 'least-motoring'
    : objective === 'allMotoring'
      ? 'all-motoring'
      : objective === 'bestWeather'
        ? 'best-weather'
        : 'fastest',
);
</script>

<SlideOver
  title="Sail Wayfinder"
  closeLabel="Close Sail Wayfinder panel"
  {onClose}
  {onBack}
  minimize={{ collapsed: minimize.collapsed, onToggle: minimize.onToggle }}
  bodyFlex
>
  <p class="muted-note">
    Set a passage from the chart or reuse a saved route. The result remains advisory and is never
    activated automatically.
  </p>

  {#if controller.status.state === 'downloading'}
    <section aria-label="Forecast download progress" role="status" aria-live="polite">
      <h3 class="caps-label">Downloading forecast</h3>
      <div class="download-status">
        <span class="download-spinner"><LoaderCircle size={18} aria-hidden="true" /></span>
        <span>
          Fetching the maximum route-specific GRIB horizon ·
          {formatDownloadElapsed(controller.status.elapsedSeconds ?? 0)}
          elapsed
        </span>
      </div>
      <p class="muted-note muted-note--xs">
        Route calculation begins after the wind and wave forecast is cached.
      </p>
    </section>
  {:else if controller.status.state === 'calculating'}
    <section aria-label="Calculation progress">
      <h3 class="caps-label">Calculating</h3>
      <progress max="100" value={controller.status.progress}>
        {Math.round(controller.status.progress)}%
      </progress>
      <p class="muted-note">{Math.round(controller.status.progress)}%</p>
      <button class="btn btn-secondary" type="button" onclick={() => void controller.cancel()}>
        Cancel calculation
      </button>
    </section>
  {:else if controller.status.state === 'complete'}
    <section aria-label="Calculated route">
      <h3 class="caps-label">Ready to save</h3>
      {#if controller.status.message}
        <p class="alert-note">{controller.status.message}</p>
      {/if}
      {#if (controller.status.alternatives?.length ?? 0) > 1}
        <label class="field">
          <span>Route alternative</span>
          <select
            class="input"
            value={controller.selectedAlternativeIndex}
            onchange={(event) => controller.selectAlternative(Number(event.currentTarget.value))}
            disabled={controller.busy}
          >
            {#each controller.status.alternatives ?? [] as alternative (alternative.index)}
              <option value={alternative.index}>
                {alternative.index + 1}. {alternative.durationHours.toFixed(1)} h,
                {alternative.distanceNm.toFixed(1)}
                nm,
                {alternative.motorHours.toFixed(1)}
                h motor
              </option>
            {/each}
          </select>
        </label>
        {@const selectedAlternative = controller.status.alternatives?.find(
          (alternative) => alternative.index === controller.selectedAlternativeIndex,
        )}
        {#if selectedAlternative}
          <p class="muted-note muted-note--xs">
            Wind avg {selectedAlternative.averageWindKn.toFixed(1)} kn · P95
            {selectedAlternative.p95WindKn?.toFixed(1) ?? PLACEHOLDER}
            kn,
            {#if selectedAlternative.averageWaveHeightM !== null}
              waves avg {selectedAlternative.averageWaveHeightM.toFixed(1)} m · P95
              {selectedAlternative.p95WaveHeightM?.toFixed(1) ?? PLACEHOLDER}
              m.
            {:else}
              no wave field in the selected forecast.
            {/if}
            {selectedTackCount} {selectedTackCount === 1 ? 'tack' : 'tacks'},
            {selectedJibeCount} {selectedJibeCount === 1 ? 'jibe' : 'jibes'}.
          </p>
        {/if}
      {/if}
      {#if selectedLegRows.length > 0}
        <details class="route-table-disclosure">
          <summary>Route table ({selectedLegRows.length} legs)</summary>
          <div class="route-table-scroll">
            <table aria-label="Selected route leg forecast">
              <thead>
                <tr>
                  <th scope="col">Leg</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Projected wind</th>
                  <th scope="col">Angle</th>
                  <th scope="col">Maneuver</th>
                </tr>
              </thead>
              <tbody>
                {#each selectedLegRows as row (row.leg)}
                  <tr>
                    <th scope="row" class="num">{row.leg}</th>
                    <td class="num">
                      {row.durationSeconds === undefined
                        ? PLACEHOLDER
                        : formatDuration(row.durationSeconds)}
                    </td>
                    <td class="num route-time">{formatRouteTime(row.startTimeMs)}</td>
                    <td class="num route-time">{formatRouteTime(row.endTimeMs)}</td>
                    <td class="num">
                      {#if row.windSpeedKn !== undefined}
                        {row.windSpeedKn.toFixed(1)}
                        kn
                        {#if row.windDirectionDeg !== undefined}
                          · {Math.round(row.windDirectionDeg)}°
                        {/if}
                      {:else}
                        {PLACEHOLDER}
                      {/if}
                    </td>
                    <td class="num">
                      {#if row.trueWindAngleDeg !== undefined}
                        {Math.round(row.trueWindAngleDeg)}° TWA
                        {#if row.windSide}
                          · {row.windSide}
                        {/if}
                      {:else}
                        {PLACEHOLDER}
                      {/if}
                    </td>
                    <td class:maneuver={row.maneuver}>{row.maneuver ?? PLACEHOLDER}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}
      <label class="field">
        <span>Route name</span>
        <input class="input" maxlength="256" bind:value={saveName}>
      </label>
      <button
        class="btn btn-primary"
        type="button"
        disabled={!saveName.trim() || controller.busy}
        onclick={() =>
          void controller.save(saveName.trim(), controller.selectedAlternativeIndex)}
      >
        Save advisory route
      </button>
      <p class="muted-note">Saving adds the route to Binnacle. It does not start navigation.</p>
    </section>
  {/if}

  {#if controller.checking}
    <p class="muted-note" role="status">Checking Sail Wayfinder readiness…</p>
  {:else if !available}
    <section aria-label="Wayfinder availability">
      <h3 class="caps-label">Not ready</h3>
      <p class="alert-note" role="status">{reason}</p>
      <button class="btn btn-secondary" type="button" onclick={() => void controller.refresh()}>
        <RefreshCw size={16} aria-hidden="true" />
        Check again
      </button>
    </section>
  {:else}
    <section class="passage-inputs" aria-label="Passage inputs">
      <h3 class="caps-label">Passage</h3>
      <div class="segmented passage-source" role="group" aria-label="Passage source">
        <button
          type="button"
          class="btn"
          class:is-on={passageSource === 'chart'}
          aria-pressed={passageSource === 'chart'}
          disabled={controller.busy}
          onclick={() => (passageSource = 'chart')}
        >
          Chart endpoints
        </button>
        <button
          type="button"
          class="btn"
          class:is-on={passageSource === 'saved'}
          aria-pressed={passageSource === 'saved'}
          disabled={controller.busy || routeStore.routes.length === 0}
          onclick={() => (passageSource = 'saved')}
        >
          Saved route
        </button>
      </div>
      {#if passageSource === 'chart'}
        <p class="muted-note muted-note--xs">
          Pan the chart until the center target is over the point you want, then capture it. On a
          phone, minimize this pane to move the chart.
        </p>
        <div class="endpoint-card">
          <div class="endpoint-readout">
            <span class="caps-label">Start</span>
            {#if startPosition}
              <span class="num">
                {formatLatitude(startPosition.latitude)},
                {formatLongitude(startPosition.longitude)}
              </span>
            {:else}
              <span class="muted-note muted-note--xs">No fresh vessel position</span>
            {/if}
          </div>
          <div class="endpoint-actions">
            <button
              type="button"
              class="btn btn-secondary"
              disabled={controller.busy || !vessel.position || vessel.positionStale}
              onclick={useVesselStart}
            >
              Use vessel
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={controller.busy || !chartCommands}
              onclick={() => setEndpointFromChart('start')}
            >
              Move start to center
            </button>
          </div>
        </div>
        <div class="endpoint-card">
          <div class="endpoint-readout">
            <span class="caps-label">Destination</span>
            {#if destinationPosition}
              <span class="num">
                {formatLatitude(destinationPosition.latitude)},
                {formatLongitude(destinationPosition.longitude)}
              </span>
            {:else}
              <span class="muted-note muted-note--xs">Not set</span>
            {/if}
          </div>
          <button
            type="button"
            class="btn btn-primary"
            disabled={controller.busy || !chartCommands}
            onclick={() => setEndpointFromChart('destination')}
          >
            Set destination from center
          </button>
        </div>
        {#if directDistanceNm !== undefined}
          <p class="muted-note muted-note--xs" role="status">
            Direct span <span class="num">{directDistanceNm.toFixed(1)} nm</span>. Wayfinder will
            calculate the navigable route.
          </p>
        {/if}
      {:else}
        {#if routeStore.routes.length === 0}
          <p class="alert-note">No saved routes are available.</p>
        {/if}
        <label class="field">
          <span>Route</span>
          <select
            class="input"
            bind:value={routeId}
            disabled={controller.busy || routeStore.routes.length === 0}
          >
            {#each routeStore.routes as route (route.id)}
              <option value={route.id}>{route.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      <div class="routing-options">
        <label class="field">
          <span>Routing objective</span>
          <select class="input" bind:value={objective} disabled={controller.busy}>
            <option value="fastest">Fastest</option>
            <option value="leastMotoring">Least motoring</option>
            <option value="allMotoring">All motoring</option>
            <option value="bestWeather">Best waves and weather</option>
          </select>
        </label>
        <UnitField
          label="Route alternatives"
          value={alternativeCount}
          min={1}
          max={controller.capabilities?.maximumAlternatives ?? 10}
          step={1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-alternatives-help"
          onCommit={(value) =>
            (alternativeCount = Math.max(
              1,
              Math.min(controller.capabilities?.maximumAlternatives ?? 10, Math.round(value)),
            ))}
        />
        <p id="wayfinder-alternatives-help" class="muted-note muted-note--xs">
          Request 1 to {controller.capabilities?.maximumAlternatives ?? 10} distinct routes, ranked
          by the selected objective.
        </p>
        {#if objective === 'fastest' || objective === 'allMotoring'}
          <UnitField
            label="Engine cruising speed"
            unit="kn"
            value={motorSpeedKn}
            min={0}
            max={100}
            step={0.1}
            disabled={controller.busy}
            ariaDescribedBy="wayfinder-engine-help"
            onCommit={(value) => (motorSpeedKn = Math.max(0, Math.min(100, value)))}
          />
        {/if}
        {#if objective === 'fastest' && motorSpeedKn > 0}
          <UnitField
            label="Motor when sailing below"
            unit="kn"
            value={motorBelowKn}
            min={0}
            max={100}
            step={0.1}
            disabled={controller.busy}
            ariaDescribedBy="wayfinder-engine-help"
            onCommit={(value) => (motorBelowKn = Math.max(0, Math.min(100, value)))}
          />
        {/if}
        {#if objective === 'fastest' || objective === 'allMotoring'}
          <p id="wayfinder-engine-help" class="muted-note muted-note--xs">
            All-motoring requires a cruising speed. Fastest uses the engine only below the sailing
            threshold; 0 disables assistance.
          </p>
        {/if}
        <label class="field">
          <span>Departure</span>
          <input
            class="input"
            type="datetime-local"
            bind:value={departure}
            disabled={controller.busy}
          >
        </label>
        <div class="constraint-row">
          <LayerToggle
            label="Daylight-only sailing"
            description="Wait at the current position whenever the sun is below the horizon."
            visible={daylightOnly}
            disabled={controller.busy}
            onToggle={(visible) => (daylightOnly = visible)}
          />
        </div>
        <UnitField
          label="Maximum underway per day"
          unit="h"
          value={maxHoursPerDay}
          min={0}
          max={24}
          step={1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-max-hours-help"
          onCommit={(value) => (maxHoursPerDay = Math.max(0, Math.min(24, value)))}
        />
        <p id="wayfinder-max-hours-help" class="muted-note muted-note--xs">
          0 is unlimited. Each passage day begins at the selected departure time.
        </p>
        <h3 class="caps-label">Routing behavior</h3>
        <p class="muted-note muted-note--xs">
          Land avoidance is always on. Route segments that cross the best installed chart shoreline
          are rejected.
        </p>
        <div class="constraint-row">
          <LayerToggle
            label="Use current forecast"
            description="Include the available current forecast in speed and timing calculations."
            visible={useCurrentGrib}
            disabled={controller.busy}
            onToggle={(visible) => (useCurrentGrib = visible)}
          />
        </div>
        {#if objective === 'leastMotoring'}
          <p class="muted-note muted-note--xs">Least motoring always waits for usable wind.</p>
        {:else if objective === 'fastest' && !canChooseWaitForWind}
          <p class="muted-note muted-note--xs">
            Motor assistance replaces waiting below the selected sailing-speed threshold.
          </p>
        {:else if canChooseWaitForWind}
          <div class="constraint-row">
            <LayerToggle
              label="Wait for wind"
              description="Allow the route to wait when wind is below the useful sailing range."
              visible={waitForWind}
              disabled={controller.busy}
              onToggle={(visible) => (waitForWind = visible)}
            />
          </div>
        {/if}
        <UnitField
          label="Maximum true wind"
          unit="kn"
          value={maxWindKn}
          min={0}
          max={200}
          step={1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-weather-limits-help"
          onCommit={(value) => (maxWindKn = Math.max(0, Math.min(200, value)))}
        />
        <UnitField
          label="Maximum significant wave height"
          unit={units.depthUnit}
          value={Number(depthValueFromMeters(maxWaveM, units.depthUnit).toFixed(1))}
          min={0}
          max={Number(depthValueFromMeters(100, units.depthUnit).toFixed(1))}
          step={0.1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-weather-limits-help"
          onCommit={(value) =>
            (maxWaveM = Math.max(0, depthValueToMeters(value, units.depthUnit)))}
        />
        <p id="wayfinder-weather-limits-help" class="muted-note muted-note--xs">
          0 disables either limit. Wayfinder rejects candidates that exceed an enabled forecast
          limit.
        </p>
        <h3 class="caps-label">Navigation safety</h3>
        <label class="field">
          <span>Signal K draft path</span>
          <input class="input" bind:value={draftPath} disabled={controller.busy}>
        </label>
        <button
          class="btn btn-secondary"
          type="button"
          disabled={controller.busy || !draftPath.trim()}
          onclick={() => void readDraftPath()}
        >
          Read draft path
        </button>
        <UnitField
          label="Vessel draft / keel depth"
          unit={units.depthUnit}
          value={Number(depthValueFromMeters(vesselDraftM, units.depthUnit).toFixed(1))}
          min={0}
          max={Number(depthValueFromMeters(100, units.depthUnit).toFixed(1))}
          step={0.1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-draft-help"
          onCommit={(value) =>
            (vesselDraftM = Math.max(0, depthValueToMeters(value, units.depthUnit)))}
        />
        <p id="wayfinder-draft-help" class="muted-note muted-note--xs">
          {#if controller.capabilities?.vesselDraft}
            Loaded from {controller.capabilities.vesselDraft.path}. Edit the value to override it
            for this plan.
          {:else}
            No numeric draft was found at this path. Enter the keel depth for this plan.
          {/if}
          Depth clearance remains a chart-reading decision; Wayfinder does not infer safe water from
          this value.
        </p>
        <UnitField
          label="Minimum shoreline clearance"
          unit="nm"
          value={minimumShoreDistanceNm}
          min={0}
          max={50}
          step={0.1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-shore-help"
          onCommit={(value) => (minimumShoreDistanceNm = Math.max(0, Math.min(50, value)))}
        />
        <UnitField
          label="Maximum distance offshore"
          unit="nm"
          value={maximumOffshoreDistanceNm}
          min={0}
          max={1_000}
          step={1}
          disabled={controller.busy}
          ariaDescribedBy="wayfinder-shore-help"
          onCommit={(value) => (maximumOffshoreDistanceNm = Math.max(0, Math.min(1_000, value)))}
        />
        <p id="wayfinder-shore-help" class="muted-note muted-note--xs">
          0 disables either limit. A close departure follows chart-safe water without an added
          margin until the route first reaches the selected minimum; the larger clearance is
          required from then on. A 0.5 nm minimum uses Wayfinder's standard safety margin without
          stacking a second clearance constraint. Shore distances use the best installed vector
          chart covering the route, with GSHHG as a fallback. Charted hazards remain advisory.
        </p>
        <button
          class="btn btn-primary"
          type="button"
          disabled={!selected ||
            !departure ||
            vesselDraftM <= 0 ||
            (objective === 'allMotoring' && motorSpeedKn <= 0) ||
            controller.busy}
          onclick={calculate}
        >
          <Compass size={18} aria-hidden="true" />
          Calculate {objectiveLabel} routes
        </button>
        {#if vesselDraftM <= 0}
          <p class="alert-note">Enter vessel draft / keel depth before calculating.</p>
        {:else if objective === 'allMotoring' && motorSpeedKn <= 0}
          <p class="alert-note">Enter engine cruising speed for an all-motoring route.</p>
        {/if}
      </div>
    </section>
  {/if}

  {#if controller.error}
    <p class="alert-note" role="alert">{controller.error}</p>
  {/if}
  {#if controller.status.state === 'idle' && controller.status.message}
    <p class="muted-note" role="status">{controller.status.message}</p>
  {/if}
</SlideOver>

<style>
.field {
  display: grid;
  gap: var(--space-1);
  margin-block: var(--space-3);
  font-size: var(--text-sm);
}
.constraint-row {
  min-block-size: var(--control-size);
  display: flex;
  align-items: center;
}
.passage-source {
  margin-block: var(--space-3);
}
.passage-source .btn {
  flex: 1;
}
.endpoint-card {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  margin-block: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}
.endpoint-readout {
  display: grid;
  gap: var(--space-1);
}
.endpoint-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: var(--space-2);
}
.endpoint-actions .btn,
.endpoint-card > .btn {
  inline-size: 100%;
}
progress {
  inline-size: 100%;
  accent-color: var(--accent);
}
.download-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-block: var(--space-2);
  color: var(--text);
  font-size: var(--text-sm);
}
.download-spinner {
  flex: 0 0 auto;
  animation: wayfinder-spin 1s linear infinite;
}
@keyframes wayfinder-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .download-spinner {
    animation: none;
  }
}
.route-table-disclosure {
  margin-block: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}
.route-table-disclosure summary {
  min-block-size: var(--control-size);
  display: flex;
  align-items: center;
  padding-inline: var(--space-3);
  font-size: var(--text-sm);
  font-weight: 650;
  cursor: pointer;
}
.route-table-scroll {
  overflow-x: auto;
  border-block-start: 1px solid var(--border);
}
.route-table-scroll table {
  min-inline-size: 760px;
  inline-size: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}
.route-table-scroll th,
.route-table-scroll td {
  padding: var(--space-2);
  border-block-end: 1px solid var(--border-subtle, var(--border));
  text-align: start;
  white-space: nowrap;
}
.route-table-scroll thead th {
  color: var(--text-muted);
  font-weight: 650;
}
.route-table-scroll tbody tr:last-child > * {
  border-block-end: 0;
}
.route-table-scroll .maneuver {
  color: var(--accent);
  font-weight: 700;
}
@media (max-width: 380px) {
  .endpoint-actions {
    grid-template-columns: 1fr;
  }
}
@media (min-width: 601px) {
  .passage-inputs {
    padding-block-end: var(--helm-actions-clearance, 0px);
  }
}
</style>

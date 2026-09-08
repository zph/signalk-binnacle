<script lang="ts">
// Sail Wayfinder panel: turns a saved route into a weather-routed passage without activating it.

import Compass from '@lucide/svelte/icons/compass';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onMount } from 'svelte';
import type { RouteStore } from '$entities/route';
import { depthValueFromMeters, depthValueToMeters, type UnitsStore } from '$entities/units';
import { LayerToggle, SlideOver, UnitField } from '$shared/ui';
import type { WayfinderObjective } from './wayfinder-client';
import type { createWayfindingController } from './wayfinding-controller.svelte';

interface Props {
  controller: ReturnType<typeof createWayfindingController>;
  routeStore: RouteStore;
  units: UnitsStore;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, routeStore, units, onClose, onBack }: Props = $props();
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
let departure = $state(new Date(Date.now() + 300_000).toISOString().slice(0, 16));
let daylightOnly = $state(false);
let maxHoursPerDay = $state(0);
let minimumShoreDistanceNm = $state(0);
let maximumOffshoreDistanceNm = $state(0);
let objective = $state<WayfinderObjective>('fastest');
let alternativeCount = $state(5);
let motorSpeedKn = $state(0);
let motorBelowKn = $state(0);
let useLandAvoidance = $state(true);
let useSafetyMargin = $state(true);
let useCurrentGrib = $state(true);
let waitForWind = $state(false);
let maxWindKn = $state(0);
let maxWaveM = $state(0);
let vesselDraftM = $state(0);
let draftPath = $state('design.draft.current');
let selectedAlternativeIndex = $state(0);
let saveName = $state('');
const selected = $derived(routeStore.routeById(routeId));

onMount(() => {
  if (!routeId && routeStore.routes[0]) routeId = routeStore.routes[0].id;
  void controller.refresh().then(() => applyDiscoveredDraft());
});

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
  saveName = `${selected.name} weather route`;
  selectedAlternativeIndex = 0;
  void controller.plan(selected, new Date(departure).toISOString(), {
    daylightOnly,
    maxHoursPerDay,
    minimumShoreDistanceNm,
    maximumOffshoreDistanceNm,
    objective,
    alternativeCount,
    motorSpeedKn,
    motorBelowKn,
    useLandAvoidance,
    useSafetyMargin,
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
  bodyFlex
>
  <p class="muted-note">
    Weather-route an existing Binnacle route. The result remains advisory and is never activated
    automatically.
  </p>

  {#if controller.status.state === 'calculating'}
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
          <select class="input" bind:value={selectedAlternativeIndex} disabled={controller.busy}>
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
        {@const selectedAlternative = controller.status.alternatives?.[selectedAlternativeIndex]}
        {#if selectedAlternative}
          <p class="muted-note muted-note--xs">
            Average wind {selectedAlternative.averageWindKn.toFixed(1)} kn,
            {#if selectedAlternative.averageWaveHeightM !== null}
              average waves {selectedAlternative.averageWaveHeightM.toFixed(1)} m.
            {:else}
              no wave field in the selected forecast.
            {/if}
          </p>
        {/if}
      {/if}
      <label class="field">
        <span>Route name</span>
        <input class="input" maxlength="256" bind:value={saveName}>
      </label>
      <button
        class="btn btn-primary"
        type="button"
        disabled={!saveName.trim() || controller.busy}
        onclick={() => void controller.save(saveName.trim(), selectedAlternativeIndex)}
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
      {#if routeStore.routes.length === 0}
        <p class="alert-note">Create and save a route in Binnacle first.</p>
      {:else}
        <label class="field">
          <span>Route</span>
          <select class="input" bind:value={routeId} disabled={controller.busy}>
            {#each routeStore.routes as route (route.id)}
              <option value={route.id}>{route.name}</option>
            {/each}
          </select>
        </label>
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
        <div class="constraint-row">
          <LayerToggle
            label="Avoid land"
            description="Reject route segments that cross the best installed chart shoreline."
            visible={useLandAvoidance}
            disabled={controller.busy}
            onToggle={(visible) => (useLandAvoidance = visible)}
          />
        </div>
        <div class="constraint-row">
          <LayerToggle
            label="Shoreline safety margin"
            description="Keep the route outside Wayfinder's additional 0.5 nm shoreline buffer."
            visible={useSafetyMargin}
            disabled={controller.busy}
            onToggle={(visible) => (useSafetyMargin = visible)}
          />
        </div>
        <div class="constraint-row">
          <LayerToggle
            label="Use current forecast"
            description="Include the available current forecast in speed and timing calculations."
            visible={useCurrentGrib}
            disabled={controller.busy}
            onToggle={(visible) => (useCurrentGrib = visible)}
          />
        </div>
        <div class="constraint-row">
          <LayerToggle
            label="Wait for wind"
            description="Allow the route to wait when wind is below the useful sailing range."
            visible={waitForWind}
            disabled={controller.busy}
            onToggle={(visible) => (waitForWind = visible)}
          />
        </div>
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
          0 disables either limit. Shore distances use the best installed vector chart covering the
          route, with GSHHG as a fallback. Charted hazards remain advisory.
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
      {/if}
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
progress {
  inline-size: 100%;
  accent-color: var(--accent);
}
@media (min-width: 601px) {
  .passage-inputs {
    padding-block-end: var(--helm-actions-clearance, 0px);
  }
}
</style>

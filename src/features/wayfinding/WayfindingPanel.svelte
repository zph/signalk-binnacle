<script lang="ts">
// Sail Wayfinder panel: turns a saved route into a weather-routed passage without activating it.

import Compass from '@lucide/svelte/icons/compass';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onMount } from 'svelte';
import type { RouteStore } from '$entities/route';
import { LayerToggle, SlideOver, UnitField } from '$shared/ui';
import type { createWayfindingController } from './wayfinding-controller.svelte';

interface Props {
  controller: ReturnType<typeof createWayfindingController>;
  routeStore: RouteStore;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, routeStore, onClose, onBack }: Props = $props();
const supportsPassageConstraints = $derived(
  controller.capabilities?.passageConstraints.includes('daylightOnly') === true &&
    controller.capabilities?.passageConstraints.includes('maxHoursPerDay') === true,
);
const available = $derived(controller.capabilities?.ready === true && supportsPassageConstraints);
const reason = $derived(
  controller.error ??
    (controller.capabilities?.ready && !supportsPassageConstraints
      ? 'Update Sail Wayfinder to use departure, daylight, and daily underway limits.'
      : undefined) ??
    controller.capabilities?.unavailableReason ??
    'Install and configure Sail Wayfinder with forecast coverage, a polar, and shoreline data.',
);
let routeId = $state('');
let departure = $state(new Date(Date.now() + 300_000).toISOString().slice(0, 16));
let daylightOnly = $state(false);
let maxHoursPerDay = $state(0);
let saveName = $state('');
const selected = $derived(routeStore.routeById(routeId));

onMount(() => {
  if (!routeId && routeStore.routes[0]) routeId = routeStore.routes[0].id;
  void controller.refresh();
});

function calculate(): void {
  if (!selected || !departure) return;
  saveName = `${selected.name} weather route`;
  void controller.plan(selected, new Date(departure).toISOString(), {
    daylightOnly,
    maxHoursPerDay,
  });
}
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
    <section aria-label="Passage inputs">
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
        <button
          class="btn btn-primary"
          type="button"
          disabled={!selected || !departure || controller.busy}
          onclick={calculate}
        >
          <Compass size={18} aria-hidden="true" />
          Calculate fastest route
        </button>
      {/if}
    </section>

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
        <label class="field">
          <span>Route name</span>
          <input class="input" maxlength="256" bind:value={saveName}>
        </label>
        <button
          class="btn btn-primary"
          type="button"
          disabled={!saveName.trim() || controller.busy}
          onclick={() => void controller.save(saveName.trim())}
        >
          Save advisory route
        </button>
        <p class="muted-note">Saving adds the route to Binnacle. It does not start navigation.</p>
      </section>
    {/if}
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
</style>

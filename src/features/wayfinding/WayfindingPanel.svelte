<script lang="ts">
import Compass from '@lucide/svelte/icons/compass';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { SlideOver } from '$shared/ui';
import type { createWayfindingController } from './wayfinding-controller.svelte';

interface Props {
  controller: ReturnType<typeof createWayfindingController>;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, onClose, onBack }: Props = $props();
const available = $derived(controller.capabilities?.ready === true);
const reason = $derived(
  controller.error ??
    controller.capabilities?.unavailableReason ??
    'Install and configure signalk-wayfinder, forecast coverage, a polar provider, shoreline data, and an eligible depth provider on the Signal K server.',
);
</script>

<SlideOver
  title="Sail wayfinding"
  closeLabel="Close sail wayfinding panel"
  {onClose}
  {onBack}
  bodyFlex
>
  <p class="muted-note">
    Plan an advisory sail passage. Review official charts, notices, weather, and local conditions
    before sailing.
  </p>

  {#if controller.checking}
    <p class="muted-note" role="status">Checking wayfinding readiness…</p>
  {:else if !available}
    <section aria-label="Wayfinding availability">
      <h3 class="caps-label">Not ready</h3>
      <p class="alert-note" role="status">{reason}</p>
      <button class="btn btn-secondary" type="button" onclick={() => void controller.refresh()}>
        <RefreshCw size={16} aria-hidden="true" />
        Check again
      </button>
    </section>
  {:else}
    <section aria-label="Wayfinding readiness">
      <h3 class="caps-label">Ready to plan</h3>
      <p class="muted-note">
        Wayfinder API {controller.capabilities?.apiVersion} is ready. Route entry and calculation
        remain unavailable until a verified polar-selection capability is supplied by the server.
      </p>
      <p class="muted-note">
        Binnacle will never substitute a generic polar or treat missing forecast, shore, tide,
        datum, or depth evidence as safe.
      </p>
    </section>
  {/if}

  <section aria-label="Safety notice">
    <h3 class="caps-label">Advisory only</h3>
    <div class="panel-controls">
      <Compass size={18} aria-hidden="true" />
      <span>Saving a future result creates a route only. It never starts navigation.</span>
    </div>
  </section>
</SlideOver>

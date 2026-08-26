<script lang="ts">
import CircleHelp from '@lucide/svelte/icons/circle-help';
import { AnchoredMenu } from '$shared/ui';

const { version }: { version: string } = $props();

let menuOpen = $state(false);
let trigger = $state<HTMLButtonElement>();
</script>

<div class="app-info-control">
  <button
    type="button"
    class="icon-pill"
    bind:this={trigger}
    aria-label="About Binnacle Custom"
    title="About Binnacle Custom"
    aria-haspopup="true"
    aria-expanded={menuOpen}
    aria-controls={menuOpen ? 'app-info-popover' : undefined}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <CircleHelp size={16} aria-hidden="true" />
  </button>
  <AnchoredMenu
    open={menuOpen}
    onClose={() => (menuOpen = false)}
    backdropLabel="Close Binnacle information"
    surfaceClass="popover-card app-info-popover"
    ariaLabel="Binnacle information"
    id="app-info-popover"
    anchor={trigger}
    preferredPlacement="above"
    anchorAlign="end"
    onFocusLeft={() => (menuOpen = false)}
  >
    <strong>Binnacle Custom</strong>
    <span class="version num">Version {version}</span>
  </AnchoredMenu>
</div>

<style>
.app-info-control {
  position: relative;
  display: flex;
}
:global(.app-info-popover) {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 12rem;
  padding: var(--space-3);
}
.version {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>

<script lang="ts">
import LockOpen from '@lucide/svelte/icons/lock-open';
import { dialog, focusOnMount } from '$shared/ui';
import type { InterfaceLockController } from './interface-lock-controller.svelte';

interface Props {
  controller: InterfaceLockController;
}

const { controller }: Props = $props();

function stayLocked(): void {}

function suppressContextMenu(event: MouseEvent): void {
  event.preventDefault();
}
</script>

{#if controller.locked}
  <dialog
    class="interface-lock-layer"
    aria-label="Binnacle controls locked"
    aria-modal="true"
    use:dialog={stayLocked}
    oncontextmenu={suppressContextMenu}
  >
    <button
      type="button"
      class="btn btn-pill unlock-control"
      aria-label="Unlock Binnacle"
      title="Unlock Binnacle"
      use:focusOnMount
      onclick={controller.unlock}
    >
      <LockOpen size={16} aria-hidden="true" />
      <span>Unlock</span>
    </button>
  </dialog>
{/if}

<style>
.interface-lock-layer {
  position: fixed;
  inset: 0;
  inline-size: 100%;
  block-size: calc(100 * var(--dvh));
  max-inline-size: none;
  max-block-size: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: not-allowed;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
  user-select: none;
}
.interface-lock-layer::backdrop {
  background: transparent;
}
.unlock-control {
  position: absolute;
  inset-inline-end: calc(var(--space-4) + env(safe-area-inset-right, 0px));
  inset-block-end: calc(var(--space-2) + var(--system-bar-clearance));
  border-color: var(--accent);
  background: var(--surface-overlay);
  color: var(--accent);
  box-shadow: var(--shadow-overlay);
  cursor: pointer;
}
@media (max-width: 600px) {
  .unlock-control {
    inset-inline-end: calc(var(--space-2) + env(safe-area-inset-right, 0px));
    inset-block-end: calc(var(--space-1) + var(--system-bar-clearance));
  }
}
</style>

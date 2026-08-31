<script lang="ts">
import LockOpen from '@lucide/svelte/icons/lock-open';
import { onDestroy } from 'svelte';
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

const UNLOCK_HOLD_MS = 5_000;
let holding = $state(false);
let remainingSeconds = $state(5);
let holdStartedAt = 0;
let holdTimer: ReturnType<typeof setInterval> | undefined;
let unlockTimer: ReturnType<typeof setTimeout> | undefined;

function cancelHold(): void {
  holding = false;
  remainingSeconds = 5;
  clearInterval(holdTimer);
  clearTimeout(unlockTimer);
  holdTimer = undefined;
  unlockTimer = undefined;
}

function startHold(event: PointerEvent): void {
  if (event.button !== 0 || holding) return;
  holding = true;
  holdStartedAt = performance.now();
  holdTimer = setInterval(() => {
    remainingSeconds = Math.max(
      1,
      Math.ceil((UNLOCK_HOLD_MS - (performance.now() - holdStartedAt)) / 1000),
    );
  }, 100);
  unlockTimer = setTimeout(() => {
    cancelHold();
    controller.unlock();
  }, UNLOCK_HOLD_MS);
}

onDestroy(cancelHold);
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
      aria-label={holding ? `Keep holding to unlock, ${remainingSeconds} seconds remaining` : 'Hold 5 seconds to unlock Binnacle'}
      title="Hold for 5 seconds to unlock"
      use:focusOnMount
      onpointerdown={startHold}
      onpointerup={cancelHold}
      onpointerleave={cancelHold}
      onpointercancel={cancelHold}
    >
      <LockOpen size={16} aria-hidden="true" />
      <span>{holding ? `Keep holding ${remainingSeconds}s` : 'Hold 5s to unlock'}</span>
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

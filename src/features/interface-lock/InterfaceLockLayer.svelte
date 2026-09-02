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
const UNLOCK_FLASH_MS = 480;
let holding = $state(false);
let unlocked = $state(false);
let remainingSeconds = $state(5);
let holdStartedAt = 0;
let holdTimer: ReturnType<typeof setInterval> | undefined;
let unlockTimer: ReturnType<typeof setTimeout> | undefined;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function cancelHold(): void {
  holding = false;
  remainingSeconds = 5;
  clearInterval(holdTimer);
  clearTimeout(unlockTimer);
  holdTimer = undefined;
  unlockTimer = undefined;
}

function release(): void {
  holding = false;
  remainingSeconds = 0;
  clearInterval(holdTimer);
  holdTimer = undefined;
  unlockTimer = undefined;
  unlocked = true;
  releaseTimer = setTimeout(() => controller.unlock(), UNLOCK_FLASH_MS);
}

function startHold(event: PointerEvent): void {
  if (event.button !== 0 || holding || unlocked) return;
  holding = true;
  holdStartedAt = performance.now();
  holdTimer = setInterval(() => {
    remainingSeconds = Math.max(
      1,
      Math.ceil((UNLOCK_HOLD_MS - (performance.now() - holdStartedAt)) / 1000),
    );
  }, 100);
  unlockTimer = setTimeout(() => {
    release();
  }, UNLOCK_HOLD_MS);
}

function cancelIfHolding(): void {
  if (holding) cancelHold();
}

$effect(() => {
  if (!controller.locked) return;
  cancelHold();
  clearTimeout(releaseTimer);
  releaseTimer = undefined;
  unlocked = false;
});

onDestroy(() => {
  cancelHold();
  clearTimeout(releaseTimer);
});
</script>

{#if controller.locked}
  <dialog
    class="interface-lock-layer"
    class:interface-lock-layer--unlocking={unlocked}
    aria-label="Binnacle controls locked"
    aria-modal="true"
    use:dialog={stayLocked}
    oncontextmenu={suppressContextMenu}
  >
    {#if holding || unlocked}
      <div class="unlock-countdown" aria-live="assertive" aria-atomic="true">
        <span class="unlock-countdown-number">{unlocked ? '✓' : remainingSeconds}</span>
        <span class="unlock-countdown-label">{unlocked ? 'Unlocked' : 'Keep holding'}</span>
      </div>
    {/if}
    <button
      type="button"
      class="btn btn-pill unlock-control"
      aria-label={unlocked
          ? 'Binnacle unlocked'
          : holding
            ? `Keep holding to unlock, ${remainingSeconds} seconds remaining`
            : 'Hold 5 seconds to unlock Binnacle'}
      title="Hold for 5 seconds to unlock"
      use:focusOnMount
      onpointerdown={startHold}
      onpointerup={cancelIfHolding}
      onpointerleave={cancelIfHolding}
      onpointercancel={cancelIfHolding}
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
.interface-lock-layer--unlocking {
  animation: unlock-flash 480ms ease-out both;
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
.unlock-countdown {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  place-items: center;
  gap: var(--space-2);
  min-inline-size: 11rem;
  transform: translate(-50%, -50%);
  color: var(--accent);
  text-align: center;
  pointer-events: none;
}
.unlock-countdown-number {
  font-family: var(--font-mono);
  font-size: clamp(7rem, 26vmin, 16rem);
  font-weight: 700;
  line-height: 0.8;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 2rem color-mix(in srgb, var(--accent) 65%, transparent);
}
.unlock-countdown-label {
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
@keyframes unlock-flash {
  0% {
    background: color-mix(in srgb, var(--accent) 0%, transparent);
  }
  35% {
    background: color-mix(in srgb, #2496ff 32%, transparent);
  }
  100% {
    background: color-mix(in srgb, #2496ff 0%, transparent);
  }
}
@media (max-width: 600px) {
  .unlock-control {
    inset-inline-end: calc(var(--space-2) + env(safe-area-inset-right, 0px));
    inset-block-end: calc(var(--space-1) + var(--system-bar-clearance));
  }
}
</style>

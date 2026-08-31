<script lang="ts">
import type { MenuItem } from './menu-item';
import { itemBlocked } from './menu-item';

interface Props {
  actions: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: { x: number; y: number } | null;
  onPositionChange?: (position: { x: number; y: number }) => void;
}

const { actions, open, onOpenChange, position = null, onPositionChange }: Props = $props();

let dial = $state<HTMLButtonElement>();
let dragPointerId = $state<number | undefined>();
let openedByPointerId = $state<number | undefined>();
let ignoreClick = $state(false);
let movingPointerId = $state<number | undefined>();
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let host = $state<HTMLDivElement>();

const MOVE_HOLD_MS = 450;
const RING_CLEARANCE_PX = 176;

function move(event: PointerEvent): void {
  if (movingPointerId !== event.pointerId || !host?.parentElement) return;
  const bounds = host.parentElement.getBoundingClientRect();
  onPositionChange?.({
    x: Math.min(
      bounds.width - RING_CLEARANCE_PX,
      Math.max(RING_CLEARANCE_PX, event.clientX - bounds.left),
    ),
    y: Math.min(
      bounds.height - RING_CLEARANCE_PX,
      Math.max(RING_CLEARANCE_PX, event.clientY - bounds.top),
    ),
  });
}

function cancelMove(): void {
  clearTimeout(holdTimer);
  holdTimer = undefined;
  movingPointerId = undefined;
}

function run(action: MenuItem): void {
  if (itemBlocked(action)) return;
  action.onSelect();
  onOpenChange(false);
}

function begin(event: PointerEvent): void {
  if (event.button !== 0) return;
  ignoreClick = true;
  if (!open) {
    onOpenChange(true);
    openedByPointerId = event.pointerId;
    dragPointerId = event.pointerId;
    dial?.setPointerCapture(event.pointerId);
    holdTimer = setTimeout(() => {
      if (dragPointerId !== event.pointerId) return;
      movingPointerId = event.pointerId;
    }, MOVE_HOLD_MS);
    return;
  }
  dragPointerId = event.pointerId;
  dial?.setPointerCapture(event.pointerId);
}

function selectFromDrag(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId || !dial) return;
  const bounds = dial.getBoundingClientRect();
  const dx = event.clientX - (bounds.left + bounds.width / 2);
  const dy = event.clientY - (bounds.top + bounds.height / 2);
  if (Math.hypot(dx, dy) < bounds.width * 0.8) return;
  const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
  const action = actions[Math.floor(angle / ((Math.PI * 2) / actions.length))];
  if (action) run(action);
}

function end(event: PointerEvent): void {
  if (movingPointerId === event.pointerId) {
    cancelMove();
    dragPointerId = undefined;
    return;
  }
  if (dragPointerId !== event.pointerId) return;
  clearTimeout(holdTimer);
  holdTimer = undefined;
  const bounds = dial?.getBoundingClientRect();
  const dx = bounds ? event.clientX - (bounds.left + bounds.width / 2) : 0;
  const dy = bounds ? event.clientY - (bounds.top + bounds.height / 2) : 0;
  if (openedByPointerId === event.pointerId && Math.hypot(dx, dy) < (bounds?.width ?? 0) * 0.8) {
    openedByPointerId = undefined;
  } else if (Math.hypot(dx, dy) < (bounds?.width ?? 0) * 0.8) {
    onOpenChange(false);
  } else {
    selectFromDrag(event);
  }
  dragPointerId = undefined;
}

const AUTO_CLOSE_MS = 10_000;
$effect(() => {
  if (!open) return;
  const timer = setTimeout(() => onOpenChange(false), AUTO_CLOSE_MS);
  return () => clearTimeout(timer);
});
</script>

<div
  class="action-dial"
  class:action-dial--open={open}
  style:inset-inline-start={position ? `${position.x}px` : undefined}
  style:inset-block-start={position ? `${position.y}px` : undefined}
  class:action-dial--positioned={position !== null}
  bind:this={host}
>
  {#if open}
    <div class="action-dial-ring" role="menu" aria-label="Quick actions">
      {#each actions as action, index (action.id)}
        {@const Icon = action.icon}
        <button
          type="button"
          role="menuitem"
          class="action-dial-wedge"
          class:action-dial-wedge--blocked={itemBlocked(action)}
          aria-label={action.label}
          disabled={itemBlocked(action)}
          style:transform={`translate(-50%, -50%) rotate(${index * (360 / actions.length)}deg) translateY(-7rem) rotate(${-index * (360 / actions.length)}deg)`}
          onclick={() => run(action)}
        >
          {#if Icon}
            <Icon size={22} aria-hidden="true" />
          {/if}
          <span>{action.shortLabel ?? action.label}</span>
        </button>
      {/each}
    </div>
  {/if}
  <button
    type="button"
    class="action-dial-core"
    aria-label={open ? 'Close quick actions' : 'Open quick actions'}
    aria-expanded={open}
    aria-haspopup="menu"
    bind:this={dial}
    onpointerdown={begin}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={() => {
      dragPointerId = undefined;
      cancelMove();
    }}
    onclick={() => {
      if (ignoreClick) {
        ignoreClick = false;
        return;
      }
      onOpenChange(!open);
    }}
  >
    <span aria-hidden="true">+</span>
  </button>
</div>

<style>
.action-dial {
  position: absolute;
  z-index: var(--z-menu);
  /* The ring grows evenly around this hub. Keep its full radius inside the chart cell, clear of
     iPad edges, browser chrome, and the bottom action row. */
  inset-inline-end: max(10.5rem, calc(env(safe-area-inset-right, 0px) + 10rem));
  inset-block-end: max(10.5rem, calc(env(safe-area-inset-bottom, 0px) + 10rem));
  inline-size: 4rem;
  block-size: 4rem;
  pointer-events: auto;
}
.action-dial--positioned {
  inset-inline-end: auto;
  inset-block-end: auto;
  transform: translate(-50%, -50%);
}
.action-dial-core {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  inline-size: 4rem;
  block-size: 4rem;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--surface-raised);
  box-shadow: var(--shadow-lg);
  color: var(--accent);
  font: inherit;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  touch-action: none;
}
.action-dial-core:active {
  filter: brightness(var(--brightness-press));
}
.action-dial-ring {
  position: absolute;
  inset: 0;
}
.action-dial-wedge {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  inline-size: 4.5rem;
  block-size: 4.5rem;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
  color: var(--text);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.1;
  text-align: center;
}
.action-dial-wedge:active:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-tint);
}
.action-dial-wedge--blocked {
  opacity: var(--disabled-opacity);
}
@media (pointer: fine) {
  .action-dial {
    display: none;
  }
}
</style>

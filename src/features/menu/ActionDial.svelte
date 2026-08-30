<script lang="ts">
import type { MenuItem } from './menu-item';
import { itemBlocked } from './menu-item';

interface Props {
  actions: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const { actions, open, onOpenChange }: Props = $props();

let dial = $state<HTMLButtonElement>();
let dragPointerId = $state<number | undefined>();
let openedByPointerId = $state<number | undefined>();
let ignoreClick = $state(false);

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
  if (Math.hypot(dx, dy) < bounds.width * 0.8) {
    onOpenChange(false);
    return;
  }
  const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
  const action = actions[Math.floor(angle / (Math.PI / 2))];
  if (action) run(action);
}

function end(event: PointerEvent): void {
  if (openedByPointerId === event.pointerId) {
    openedByPointerId = undefined;
    return;
  }
  if (dragPointerId !== event.pointerId) return;
  selectFromDrag(event);
  dragPointerId = undefined;
}
</script>

<div class="action-dial" class:action-dial--open={open}>
  {#if open}
    <div class="action-dial-ring" role="menu" aria-label="Quick actions">
      {#each actions as action (action.id)}
        {@const Icon = action.icon}
        <button
          type="button"
          role="menuitem"
          class="action-dial-wedge"
          class:action-dial-wedge--blocked={itemBlocked(action)}
          aria-label={action.label}
          disabled={itemBlocked(action)}
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
    onpointerup={end}
    onpointercancel={() => (dragPointerId = undefined)}
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
  inset-inline-end: max(var(--space-3), env(safe-area-inset-right, 0px));
  inset-block-end: max(var(--space-3), env(safe-area-inset-bottom, 0px));
  inline-size: 4rem;
  block-size: 4rem;
  pointer-events: auto;
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
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
  min-inline-size: 7.5rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  white-space: nowrap;
}
.action-dial-wedge:nth-child(1) {
  inset-block-end: calc(100% + var(--space-2));
  inset-inline-end: 0;
}
.action-dial-wedge:nth-child(2) {
  inset-block-start: 0;
  inset-inline-start: calc(100% + var(--space-2));
}
.action-dial-wedge:nth-child(3) {
  inset-block-start: calc(100% + var(--space-2));
  inset-inline-end: 0;
}
.action-dial-wedge:nth-child(4) {
  inset-block-start: 0;
  inset-inline-end: calc(100% + var(--space-2));
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

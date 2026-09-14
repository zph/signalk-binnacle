<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import { AnchoredMenu, InlineConfirm, NameEntry } from '$shared/ui';
import type { InstrumentLayoutsController } from './instrument-layouts-controller.svelte';
import { layoutSwipe } from './layout-shortcuts';

const {
  controller,
  editing,
  onEdit,
  inline = false,
}: {
  controller: InstrumentLayoutsController;
  editing: boolean;
  onEdit: () => void;
  inline?: boolean;
} = $props();
let anchor = $state<HTMLButtonElement>();
let action = $state<'rename' | 'duplicate' | 'restore' | undefined>();
function close() {
  controller.setMenuOpen(false);
  action = undefined;
}
</script>

<div
  class="layout-selector"
  class:layout-selector--inline={inline}
  role="group"
  aria-label="Instrument layout selector"
  use:layoutSwipe={{ enabled: !editing, step: controller.cycle }}
>
  <button
    class="icon-btn"
    type="button"
    aria-label="Previous instrument layout"
    disabled={editing}
    onclick={() => controller.cycle(-1)}
  >
    <ChevronLeft size={18} />
  </button>
  <button
    class="btn layout-name"
    type="button"
    data-layout-swipe
    bind:this={anchor}
    aria-expanded={controller.menuOpen}
    onclick={() => controller.setMenuOpen(!controller.menuOpen)}
  >
    <span aria-live="polite">{controller.active?.name ?? 'My instruments'}</span>
    <ChevronDown size={16} />
  </button>
  <button
    class="icon-btn"
    type="button"
    aria-label="Next instrument layout"
    disabled={editing}
    onclick={() => controller.cycle(1)}
  >
    <ChevronRight size={18} />
  </button>
</div>
<AnchoredMenu
  surfaceClass="popover-card menu-surface instrument-layout-menu"
  backdropClass="instrument-layout-backdrop"
  role="dialog"
  open={controller.menuOpen}
  {anchor}
  onClose={close}
  backdropLabel="Close instrument layouts"
  ariaLabel="Instrument layouts"
  focusTrap
>
  <div class="layout-options">
    {#if action === 'rename' || action === 'duplicate'}
      <NameEntry
        label={action === 'rename' ? 'Rename instrument layout' : 'Duplicate instrument layout'}
        value={`${controller.active?.name ?? ''}${action === 'duplicate' ? ' copy' : ''}`}
        maxLength={60}
        onConfirm={(name) => { if (!name.trim()) return; if (action === 'rename') controller.rename(name); else controller.duplicate(name); action = undefined; }}
        onCancel={() => (action = undefined)}
      />
    {:else if action === 'restore'}
      <InlineConfirm
        question="Replace this layout with its starter arrangement?"
        confirmLabel="Restore"
        onConfirm={() => { controller.restore(); action = undefined; }}
        onCancel={() => (action = undefined)}
      />
    {:else}
      {#each controller.layouts as layout (layout.id)}
        <button
          type="button"
          class="menu-item"
          aria-pressed={controller.active?.id === layout.id}
          disabled={editing}
          onclick={() => { controller.select(layout.id); close(); }}
        >
          {layout.name}{controller.active?.id === layout.id ? ' ✓' : ''}
        </button>
      {/each}
      <div class="panel-controls">
        <button
          type="button"
          class="btn"
          onclick={() => (action = 'duplicate')}
          disabled={controller.layouts.length >= 20}
        >
          Duplicate
        </button>
        <button type="button" class="btn" onclick={() => (action = 'rename')}>Rename</button>
        {#if ['marina', 'leisure', 'performance'].includes(controller.active?.id ?? '')}
          <button type="button" class="btn" onclick={() => (action = 'restore')} disabled={editing}>
            Restore defaults
          </button>
        {/if}
        <button type="button" class="btn" onclick={() => { close(); onEdit(); }}>
          Edit instruments
        </button>
      </div>
      <p class="muted-note">
        {editing ? 'Finish editing to switch layouts.' : 'Swipe left or right on an instrument, or use Cmd + ← / →. Charts and history keep their own gestures.'}
      </p>
    {/if}
  </div>
</AnchoredMenu>

<style>
.layout-selector {
  position: absolute;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  inset-block-end: calc(5rem + env(safe-area-inset-bottom, 0px));
  z-index: 4;
  display: flex;
  align-items: center;
  max-inline-size: calc(100% - 2rem);
  pointer-events: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  touch-action: pan-y;
}
.layout-name {
  min-inline-size: 0;
}
.layout-selector--inline {
  position: relative;
  inset: auto;
  transform: none;
  max-inline-size: 100%;
  align-self: center;
}
.layout-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  max-inline-size: 22rem;
}
:global(.instrument-layout-menu) {
  --menu-width: 22rem;
  pointer-events: auto;
  max-block-size: calc(100dvh - 2rem);
  overflow-y: auto;
}
:global(.instrument-layout-backdrop) {
  pointer-events: auto;
}
</style>

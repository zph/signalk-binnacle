<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import { untrack } from 'svelte';
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
let feedback = $state(false);
let previousId = untrack(() => controller.active?.id);
const position = $derived(
  controller.layouts.findIndex((layout) => layout.id === controller.active?.id) + 1,
);
$effect(() => {
  const id = controller.active?.id;
  if (id === previousId) return;
  previousId = id;
  feedback = true;
  const timer = setTimeout(() => (feedback = false), 1800);
  return () => clearTimeout(timer);
});
function close() {
  controller.setMenuOpen(false);
  action = undefined;
}
</script>

<div
  class="layout-selector"
  class:layout-selector--inline={inline}
  class:layout-selector--revealed={feedback || controller.menuOpen || editing}
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
    <span aria-live="polite"
      >{controller.active?.name ?? 'My instruments'}
      · {position}/{controller.layouts.length}</span
    >
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  inline-size: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
  touch-action: pan-y;
}
.layout-selector--revealed,
.layout-selector:hover,
.layout-selector:focus-within,
.layout-selector--inline {
  opacity: 1;
}
.layout-selector--revealed button,
.layout-selector:hover button,
.layout-selector:focus-within button,
.layout-selector--inline button {
  pointer-events: auto;
}
@media (hover: hover) {
  :global(.instrument-screen-layer:has(.floating-frame:hover)) .layout-selector,
  :global(.instrument-screen-layer:has(.floating-frame:focus-within)) .layout-selector,
  :global(.instrument-profile-header:hover) .layout-selector {
    opacity: 1;
  }
  :global(.instrument-screen-layer:has(.floating-frame:hover)) .layout-selector button,
  :global(.instrument-screen-layer:has(.floating-frame:focus-within)) .layout-selector button,
  :global(.instrument-profile-header:hover) .layout-selector button {
    pointer-events: auto;
  }
}
.layout-selector button {
  background: var(--surface-overlay);
}
.layout-name {
  min-inline-size: 0;
}
.layout-selector--inline {
  max-inline-size: 100%;
}
.layout-selector--inline .icon-btn {
  opacity: 0;
  pointer-events: none;
}
.layout-selector--inline:hover .icon-btn,
.layout-selector--inline:focus-within .icon-btn {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: hover) {
  :global(.instruments:hover) .layout-selector--inline .icon-btn {
    opacity: 1;
    pointer-events: auto;
  }
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
  max-block-size: calc(100 * var(--dvh) - 2 * var(--space-4));
  overflow-y: auto;
}
:global(.instrument-layout-backdrop) {
  pointer-events: auto;
}
</style>

<script lang="ts">
import Lock from '@lucide/svelte/icons/lock';
import LockOpen from '@lucide/svelte/icons/lock-open';
import Pencil from '@lucide/svelte/icons/pencil';
import ScanSearch from '@lucide/svelte/icons/scan-search';
import X from '@lucide/svelte/icons/x';
import { AnchoredMenu, rovingFocus } from '$shared/ui';

interface Props {
  label?: string;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  customizing: boolean;
  reordering: boolean;
  onInspect?: () => void;
  onToggleCustomize: () => void;
  onToggleReorder: () => void;
  onClosePanel: () => void;
  onClose: () => void;
}

const {
  label,
  x,
  y,
  viewportWidth,
  viewportHeight,
  customizing,
  reordering,
  onInspect,
  onToggleCustomize,
  onToggleReorder,
  onClosePanel,
  onClose,
}: Props = $props();

// These pixel values mirror the fixed menu width, one --control-size row, two --space-1 padding
// edges, and the --space-2 viewport clearance used by the chart context menu.
const MENU_WIDTH = 224;
const MENU_HEIGHT = $derived((onInspect ? 4 : 3) * 44 + 8);
const EDGE = 8;
const left = $derived(
  Math.min(Math.max(x, EDGE), Math.max(EDGE, viewportWidth - MENU_WIDTH - EDGE)),
);
const top = $derived(
  Math.min(Math.max(y, EDGE), Math.max(EDGE, viewportHeight - MENU_HEIGHT - EDGE)),
);
</script>

<AnchoredMenu
  open={true}
  {onClose}
  backdropLabel="Dismiss instrument actions"
  backdropClass="instrument-context-backdrop"
  surfaceClass="popover-card instrument-context-menu"
  ariaLabel={label ? `${label} actions` : 'Instrument pane actions'}
  role="menu"
  surfaceStyle={`left: ${left}px; top: ${top}px; inline-size: ${MENU_WIDTH}px;`}
  onFocusLeft={onClose}
>
  <div class="rows" use:rovingFocus={'[role="menuitem"]'}>
    {#if onInspect}
      <button type="button" role="menuitem" class="menu-item item" onclick={onInspect}>
        <ScanSearch size={16} aria-hidden="true" />
        Inspect
      </button>
    {/if}
    <button type="button" role="menuitem" class="menu-item item" onclick={onToggleReorder}>
      {#if reordering}
        <Lock size={16} aria-hidden="true" />
        Lock instrument arrangement
      {:else}
        <LockOpen size={16} aria-hidden="true" />
        Unlock instrument arrangement
      {/if}
    </button>
    <button type="button" role="menuitem" class="menu-item item" onclick={onToggleCustomize}>
      <Pencil size={16} aria-hidden="true" />
      {customizing ? 'Finish customizing' : 'Customize instruments'}
    </button>
    <button type="button" role="menuitem" class="menu-item item danger" onclick={onClosePanel}>
      <X size={16} aria-hidden="true" />
      Close instruments
    </button>
  </div>
</AnchoredMenu>

<style>
:global(.instrument-context-menu) {
  position: fixed;
  z-index: calc(var(--z-menu) + 1);
  padding: var(--space-1);
}
:global(.instrument-context-backdrop) {
  z-index: var(--z-menu);
}
.rows {
  display: contents;
}
.item {
  white-space: nowrap;
}
.danger {
  color: var(--danger);
}
</style>

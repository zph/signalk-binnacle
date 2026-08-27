<script lang="ts">
import ScanSearch from '@lucide/svelte/icons/scan-search';
import { AnchoredMenu, rovingFocus } from '$shared/ui';

interface Props {
  label: string;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  onInspect: () => void;
  onClose: () => void;
}

const { label, x, y, viewportWidth, viewportHeight, onInspect, onClose }: Props = $props();

// These pixel values mirror the fixed menu width, one --control-size row, two --space-1 padding
// edges, and the --space-2 viewport clearance used by the chart context menu.
const MENU_WIDTH = 160;
const MENU_HEIGHT = 52;
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
  ariaLabel={`${label} actions`}
  role="menu"
  surfaceStyle={`left: ${left}px; top: ${top}px; inline-size: ${MENU_WIDTH}px;`}
  onFocusLeft={onClose}
>
  <div class="rows" use:rovingFocus={'[role="menuitem"]'}>
    <button type="button" role="menuitem" class="menu-item item" onclick={onInspect}>
      <ScanSearch size={16} aria-hidden="true" />
      Inspect
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
</style>

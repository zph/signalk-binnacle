<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronUp from '@lucide/svelte/icons/chevron-up';

let {
  bottomBarVisible,
  onToggleBottom,
}: {
  bottomBarVisible: boolean;
  onToggleBottom: () => void;
} = $props();
</script>

<nav class="shell-bar-tabs" aria-label="Bottom bar visibility">
  <button
    type="button"
    class="shell-bar-tab"
    class:bar-visible={bottomBarVisible}
    aria-controls="bottom-toolbar"
    aria-expanded={bottomBarVisible}
    aria-label={bottomBarVisible ? 'Hide bottom bar' : 'Show bottom bar'}
    title={bottomBarVisible ? 'Hide bottom bar' : 'Show bottom bar'}
    onclick={onToggleBottom}
  >
    {#if bottomBarVisible}
      <ChevronDown size={18} aria-hidden="true" />
    {:else}
      <ChevronUp size={18} aria-hidden="true" />
    {/if}
  </button>
</nav>

<style>
.shell-bar-tabs {
  position: absolute;
  inset-block-end: 100%;
  inset-inline-end: max(var(--space-2), env(safe-area-inset-right));
  z-index: var(--z-panel);
  display: flex;
}
.shell-bar-tab {
  display: grid;
  place-items: center;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  padding: 0;
  border: 1px solid var(--border);
  border-block-end: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  box-shadow: var(--shadow-overlay);
  background: var(--surface-overlay);
  color: var(--text-muted);
  cursor: pointer;
}
.shell-bar-tab.bar-visible {
  background: var(--surface);
}
.shell-bar-tab:hover {
  color: var(--text);
}
.shell-bar-tab:active {
  filter: brightness(var(--brightness-press));
}
</style>

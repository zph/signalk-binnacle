<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronUp from '@lucide/svelte/icons/chevron-up';

let {
  topBarVisible,
  bottomBarVisible,
  onToggleTop,
  onToggleBottom,
}: {
  topBarVisible: boolean;
  bottomBarVisible: boolean;
  onToggleTop: () => void;
  onToggleBottom: () => void;
} = $props();
</script>

<nav class="shell-bar-tabs" aria-label="Page bar visibility">
  <button
    type="button"
    class="shell-bar-tab"
    aria-controls="top-toolbar"
    aria-expanded={topBarVisible}
    aria-label={topBarVisible ? 'Hide top bar' : 'Show top bar'}
    title={topBarVisible ? 'Hide top bar' : 'Show top bar'}
    onclick={onToggleTop}
  >
    {#if topBarVisible}
      <ChevronUp size={18} aria-hidden="true" />
    {:else}
      <ChevronDown size={18} aria-hidden="true" />
    {/if}
  </button>
  <button
    type="button"
    class="shell-bar-tab"
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
  position: fixed;
  inset-block-start: 50%;
  inset-inline-end: 0;
  z-index: var(--z-panel);
  display: grid;
  gap: 1px;
  transform: translateY(-50%);
}
.shell-bar-tab {
  display: grid;
  place-items: center;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  padding: 0;
  border: 1px solid var(--border);
  border-inline-end: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  box-shadow: var(--shadow-overlay);
  background: var(--surface-overlay);
  color: var(--text-muted);
  cursor: pointer;
}
.shell-bar-tab:hover {
  color: var(--text);
}
.shell-bar-tab:active {
  filter: brightness(var(--brightness-press));
}
</style>

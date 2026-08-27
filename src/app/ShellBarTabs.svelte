<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronUp from '@lucide/svelte/icons/chevron-up';
import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';

let {
  bottomBarVisible,
  instrumentsOpen,
  instrumentsFullScreen = false,
  onToggleBottom,
  onToggleInstruments,
}: {
  bottomBarVisible: boolean;
  instrumentsOpen: boolean;
  instrumentsFullScreen?: boolean;
  onToggleBottom: () => void;
  onToggleInstruments: () => void;
} = $props();
</script>

<nav class="shell-side-tabs" aria-label="Instrument dock visibility">
  <button
    type="button"
    class="shell-side-tab shell-side-tab--right"
    class:panel-visible={instrumentsOpen}
    class:panel-fullscreen={instrumentsFullScreen}
    aria-controls={instrumentsOpen ? 'instrument-dock' : undefined}
    aria-expanded={instrumentsOpen}
    aria-label={instrumentsOpen ? 'Close instrument dock' : 'Open instrument dock'}
    title={instrumentsOpen ? 'Close instrument dock' : 'Open instrument dock'}
    onclick={onToggleInstruments}
  >
    {#if instrumentsOpen}
      <PanelRightClose size={18} aria-hidden="true" />
    {:else}
      <PanelRightOpen size={18} aria-hidden="true" />
    {/if}
  </button>
</nav>

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
.shell-side-tab {
  position: fixed;
  inset-block-start: 50%;
  z-index: var(--z-menu);
  display: grid;
  place-items: center;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  padding: 0;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-overlay);
  background: var(--surface-overlay);
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
}
.shell-side-tab--right {
  inset-inline-end: 0;
  border-inline-end: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
}
.shell-side-tab--right.panel-visible:not(.panel-fullscreen) {
  inset-inline-end: min(var(--instrument-dock-width), calc(100dvw - var(--control-size)));
}
.shell-side-tab.panel-visible {
  background: var(--surface);
  color: var(--text);
}
.shell-bar-tabs {
  position: absolute;
  inset-block-end: 100%;
  inset-inline-start: 50%;
  z-index: var(--z-panel);
  display: flex;
  transform: translateX(-50%);
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
.shell-side-tab:hover {
  color: var(--text);
}
.shell-side-tab:active,
.shell-bar-tab:active {
  filter: brightness(var(--brightness-press));
}
</style>

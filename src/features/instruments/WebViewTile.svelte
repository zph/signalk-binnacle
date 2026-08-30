<script lang="ts">
import Maximize2 from '@lucide/svelte/icons/maximize-2';
import Minimize2 from '@lucide/svelte/icons/minimize-2';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import type { TileDef, TileReading } from './tile-catalog';

interface Props {
  def: TileDef; // kind 'webview', def.webview defined
  label: string;
  reading: TileReading;
  expanded?: boolean;
  actionLabel: string; // 'Expand instrument' / 'Collapse instrument'
  onOpen: () => void;
}

const { def, label, reading: _reading, expanded = false, actionLabel, onOpen }: Props = $props();

let loaded = $state(false);
// Remounting the keyed iframe is the one reload that works for every source kind: a cross-origin
// frame's window cannot be reached to call location.reload() on it.
let reloadKey = $state(0);

const sandbox = $derived(
  // Same-origin boat apps need their origin to call Signal K APIs with credentials; an opaque
  // sandboxed origin would break them. The footgun (a sandboxed same-origin frame can strip its
  // own sandbox) is accepted because sources are admin-curated, validated, same-origin apps.
  def.webview?.kind === 'app'
    ? 'allow-scripts allow-same-origin allow-forms'
    : // External content gets an opaque origin and cannot reach Binnacle's storage or credentials.
      'allow-scripts allow-forms',
);

function reload(): void {
  reloadKey += 1;
  loaded = false;
}
</script>

<section class="tile webview-tile" class:expanded aria-label={`${label}, web view`}>
  {#key reloadKey}
    <iframe
      title={label}
      src={def.webview?.url ?? 'about:blank'}
      referrerpolicy="no-referrer"
      loading="eager"
      {sandbox}
      onload={() => (loaded = true)}
    ></iframe>
  {/key}
  <div class="webview-controls" role="group" aria-label={`${label} controls`}>
    <button
      type="button"
      class="icon-btn"
      aria-label={`Reload ${label}`}
      title={`Reload ${label}`}
      onclick={reload}
    >
      <RotateCw size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={onOpen}
    >
      {#if expanded}
        <Minimize2 size={18} aria-hidden="true" />
      {:else}
        <Maximize2 size={18} aria-hidden="true" />
      {/if}
    </button>
  </div>
  {#if !loaded}
    <div class="loading-note muted-note" role="status">Loading…</div>
  {/if}
</section>

<style>
.webview-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-block-size: var(--tile-min-height);
  padding: 0;
  overflow: hidden;
  background: var(--surface);
  color: var(--text);
}
.webview-tile iframe {
  flex: 1;
  inline-size: 100%;
  min-block-size: 0;
  border: 0;
}
.webview-controls {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  z-index: 1;
  display: flex;
  gap: var(--space-1);
}
.webview-controls .icon-btn {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  background: color-mix(in srgb, var(--surface-raised) 90%, transparent);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(6px);
}
.loading-note {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text-muted);
  pointer-events: none;
}
.webview-tile.expanded {
  min-block-size: 100%;
}
</style>

<script module lang="ts">
export function focusLayerOpacityControl(control: HTMLElement | undefined): void {
  control?.focus({ preventScroll: true });
}

export function restoreLayerOpacityFocus(
  trigger: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  body: HTMLElement = document.body,
): void {
  if (
    trigger?.isConnected &&
    (activeElement === null || activeElement === body || !activeElement.isConnected)
  ) {
    trigger.focus({ preventScroll: true });
  }
}
</script>

<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import Settings2 from '@lucide/svelte/icons/settings-2';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import type { LayerListItem } from '$shared/map';
import { AnchoredMenu, LayerToggle, UnavailableHint } from '$shared/ui';
import type { LayersView } from './layers-view.svelte';

interface Props {
  item: LayerListItem;
  view: LayersView;
  index: number;
  count: number;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onHandlePointerDown: (event: PointerEvent) => void;
  onHandleKeydown: (event: KeyboardEvent) => void;
  // Present only on a user-imported chart row, which opens a detail (rename, info, delete).
  onManage?: () => void;
  manageLabel?: string;
  draggable?: boolean;
  // Sub-layers of this row (a chart facet, for example NOAA ENC data quality). When present, the row
  // renders as a facet group: one handle moves the group, and a collapsed disclosure exposes each
  // child's independent visibility and opacity. Children stay disabled while this row is off, so a
  // facet never renders without the chart it belongs to.
  subLayers?: LayerListItem[];
  // Set when this row is the top-level facet of a named group (NOAA ENC). The visible group title is
  // drawn by the panel above the card; here it names the listitem so a screen reader speaks the group
  // the row belongs to, since the visible title is decorative.
  groupTitle?: string;
  // A fresh object expands this row's child facets. Command K uses it to open basemap controls
  // directly, including on a repeated request while the Layers panel is already mounted.
  expandRequest?: object;
}

const {
  item,
  view,
  index,
  count,
  dragging,
  dropBefore,
  dropAfter,
  onHandlePointerDown,
  onHandleKeydown,
  onManage,
  manageLabel,
  draggable = true,
  subLayers = [],
  groupTitle,
  expandRequest,
}: Props = $props();

// A layer at zero opacity while its toggle stays checked is a silent failure for safety layers
// (AIS, anchor ring), so the slider floor keeps them faintly visible.
const MIN_LAYER_OPACITY = 0.15;
// A row only counts as a facet group when it actually has sub-layers nested under it: a row that
// merely shares a group id with something it is not the parent of (for example a plain sibling row
// tagged with the same group for display grouping alone) keeps its own title.
const isFacetGroup = $derived(subLayers.length > 0);
// Chart rows keep a disclosure slot even when the provider exposes no child facets. That makes the
// capability discoverable and keeps the visibility/detail controls aligned across the Charts list.
// Non-chart rows only reserve the slot when they actually own child layers.
const showFacetCaret = $derived(isFacetGroup || item.chart !== undefined);
// The drag handle moves the whole row, so for a facet group it names the group, otherwise the layer.
const handleLabel = $derived(isFacetGroup ? (groupTitle ?? item.title) : item.title);

let tuneId = $state<string>();
let tuneTrigger = $state<HTMLButtonElement>();
let tuneControl = $state<HTMLInputElement>();
let wasTuneOpen = false;
let facetsExpanded = $state(false);
$effect(() => {
  if (expandRequest) facetsExpanded = true;
});
const componentId = $props.id();
const itemUnavailableId = $derived(`layer-${item.id}-unavailable`);
const facetPanelId = `${componentId}-chart-layers`;
const activeFacetPresetId = $derived.by(() => {
  for (const preset of item.facetPresets ?? []) {
    if (
      subLayers.every(
        (sub) =>
          preset.visibility[sub.id] === undefined || preset.visibility[sub.id] === sub.visible,
      )
    ) {
      return preset.id;
    }
  }
  return undefined;
});

function canTuneLayer(layer: LayerListItem): boolean {
  const parentAllows = layer.parent === undefined || (item.visible && item.available);
  return layer.supportsOpacity && layer.visible && layer.available && parentAllows;
}

// A facet child's accessible description points at whichever hint explains why it is disabled: its
// own provider-absent hint when the child is unavailable, otherwise the parent's hint when only the
// parent is unavailable, and none when nothing unavailable has hint text to show.
function childDescribedBy(sub: LayerListItem, subUnavailableId: string): string | undefined {
  if (!sub.available) return sub.unavailableHint ? subUnavailableId : undefined;
  if (item.available || !item.unavailableHint) return undefined;
  return itemUnavailableId;
}
// Close the popover if the layer is hidden while it is open: the popover lives inside the canTune
// block, so without this re-showing the layer would pop it back open unprompted.
$effect(() => {
  const active = tuneId === item.id ? item : subLayers.find((layer) => layer.id === tuneId);
  if (!active || !canTuneLayer(active)) tuneId = undefined;
});
$effect(() => {
  if (tuneId) {
    wasTuneOpen = true;
    let focusFrame = 0;
    const positionFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => focusLayerOpacityControl(tuneControl));
    });
    return () => {
      cancelAnimationFrame(positionFrame);
      cancelAnimationFrame(focusFrame);
    };
  }
  if (!wasTuneOpen) return;
  wasTuneOpen = false;
  const frame = requestAnimationFrame(() => restoreLayerOpacityFocus(tuneTrigger));
  return () => cancelAnimationFrame(frame);
});
</script>

{#snippet dragHandle()}
  <button
    type="button"
    class="icon-btn handle"
    aria-label={`Move ${handleLabel}, position ${index + 1} of ${count}`}
    aria-keyshortcuts="ArrowUp ArrowDown"
    onpointerdown={onHandlePointerDown}
    onkeydown={onHandleKeydown}
  >
    <GripVertical size={18} aria-hidden="true" />
  </button>
{/snippet}

{#snippet facetCaret()}
  <button
    type="button"
    class="facet-caret"
    class:is-open={facetsExpanded}
    aria-label={isFacetGroup
      ? `${facetsExpanded ? 'Hide' : 'Show'} ${item.title} child layers`
      : `No child layers for ${item.title}`}
    aria-expanded={isFacetGroup ? facetsExpanded : undefined}
    aria-controls={isFacetGroup ? facetPanelId : undefined}
    disabled={!isFacetGroup}
    onclick={() => {
      if (isFacetGroup) facetsExpanded = !facetsExpanded;
    }}
  >
    <ChevronRight size={18} aria-hidden="true" />
  </button>
{/snippet}

{#snippet opacityControl(layer: LayerListItem)}
  {#if canTuneLayer(layer)}
    <div class="tune-anchor">
      <button
        type="button"
        class="icon-btn"
        class:icon-btn--accent={layer.opacity < 1}
        aria-label={`Adjust ${layer.title} opacity`}
        aria-expanded={tuneId === layer.id}
        onclick={(event) => {
          tuneTrigger = event.currentTarget;
          tuneId = tuneId === layer.id ? undefined : layer.id;
        }}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
      </button>
      <AnchoredMenu
        open={tuneId === layer.id}
        onClose={() => {
          if (tuneId === layer.id) tuneId = undefined;
        }}
        backdropLabel={`Close ${layer.title} opacity`}
        ariaLabel={`${layer.title} opacity`}
        surfaceClass="popover-card tune-pop"
        anchor={tuneTrigger}
        preferredPlacement="below"
        anchorAlign="end"
        onFocusLeft={() => {
          if (tuneId === layer.id) tuneId = undefined;
        }}
      >
        <div class="tune-body">
          <input
            class="range"
            type="range"
            min={MIN_LAYER_OPACITY}
            max="1"
            step="0.05"
            value={layer.opacity}
            aria-label={`${layer.title} opacity`}
            aria-valuetext={`${Math.round(layer.opacity * 100)}%`}
            bind:this={tuneControl}
            oninput={(e) => view.setOpacity(layer.id, Number(e.currentTarget.value), false)}
            onchange={(e) => view.setOpacity(layer.id, Number(e.currentTarget.value))}
          >
          <span class="num tune-val">{Math.round(layer.opacity * 100)}%</span>
          <button
            type="button"
            class="icon-btn"
            aria-label="Reset opacity"
            onclick={() => view.setOpacity(layer.id, 1)}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      </AnchoredMenu>
    </div>
  {/if}
{/snippet}

{#snippet trailing()}
  <div class="trail">
    {#if !item.chart}
      {@render opacityControl(item)}
    {/if}
    {#if onManage}
      <button
        type="button"
        class="icon-btn"
        aria-label={manageLabel ?? `Manage ${item.title}`}
        onclick={onManage}
      >
        <Settings2 size={18} aria-hidden="true" />
      </button>
    {/if}
  </div>
{/snippet}

{#snippet regionTag()}
  {#if item.region && !item.chart}
    <span class="region-tag">{item.region}</span>
  {/if}
{/snippet}

<li
  class="list-row row reorder-row"
  class:dragging
  class:drop-before={dropBefore}
  class:drop-after={dropAfter}
  class:is-on={item.visible && item.available}
  class:unavailable={!item.available}
  aria-label={isFacetGroup ? groupTitle : undefined}
  title={item.available ? undefined : item.unavailableHint}
  data-layer-row={item.id}
>
  <UnavailableHint
    id={itemUnavailableId}
    hint={item.available ? undefined : item.unavailableHint}
  />
  {#if isFacetGroup}
    <!-- A facet group: one handle moves the whole group, the parent and child toggles share one
         aligned column, and the tune control sits on the parent line. -->
    <div class="facet-row">
      {#if draggable}
        <span class="lead">{@render dragHandle()}</span>
      {/if}
      <div class="facet-stack">
        <div class="facet-line">
          <LayerToggle
            label={item.title}
            description={item.description}
            visible={item.visible}
            disabled={!item.available}
            describedBy={!item.available && item.unavailableHint ? itemUnavailableId : undefined}
            onToggle={(visible) => view.toggle(item.id, visible)}
            presentation="row"
          />
          {@render facetCaret()}
          {@render regionTag()}
          {@render trailing()}
        </div>
        <div
          class="facet-disclosure"
          id={facetPanelId}
          role="group"
          aria-label={`${item.title} child layers`}
          hidden={!facetsExpanded}
        >
          {#if item.facetPresets && item.facetPresets.length > 0}
            <div class="facet-presets">
              <p class="muted-note muted-note--xs">
                Start with a detail preset, then adjust any child layer.
              </p>
              <div class="segmented" role="group" aria-label={`${item.title} detail preset`}>
                {#each item.facetPresets as preset (preset.id)}
                  <button
                    type="button"
                    class="btn"
                    class:is-on={activeFacetPresetId === preset.id}
                    aria-pressed={activeFacetPresetId === preset.id}
                    title={preset.description}
                    onclick={() => view.applyFacetPreset(item.id, preset.visibility)}
                  >
                    {preset.title}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          {#each subLayers as sub (sub.id)}
            {@const subUnavailableId = `layer-${sub.id}-unavailable`}
            <div
              class="facet-line facet-child"
              class:unavailable={!sub.available}
              title={sub.available ? undefined : sub.unavailableHint}
            >
              <UnavailableHint
                id={subUnavailableId}
                hint={sub.available ? undefined : sub.unavailableHint}
              />
              <LayerToggle
                label={sub.title}
                description={sub.description}
                visible={sub.visible}
                disabled={!item.available || !item.visible || !sub.available}
                describedBy={childDescribedBy(sub, subUnavailableId)}
                onToggle={(visible) => view.toggle(sub.id, visible)}
                presentation="row"
              />
              {@render opacityControl(sub)}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="row-main">
      {#if draggable}
        <span class="lead">{@render dragHandle()}</span>
      {/if}
      <LayerToggle
        label={item.title}
        description={item.description}
        visible={item.visible}
        disabled={!item.available}
        describedBy={!item.available && item.unavailableHint ? itemUnavailableId : undefined}
        onToggle={(visible) => view.toggle(item.id, visible)}
        presentation="row"
      />
      {#if showFacetCaret}
        {@render facetCaret()}
      {/if}
      {@render regionTag()}
      {@render trailing()}
    </div>
  {/if}
</li>

<style>
/* Flat list row: no card border or fill, a hairline divider draws between rows in the panel. The whole
   row is one module, a lead rail (drag handle), the toggle and title in the flexible center, and a
   trailing rail (tune, manage), so every row reads on the same two rails down the panel. */
/* The flat-row skeleton (height, padding, divider) comes from the shared .list-row, and the drag
   feedback (positioning context, the dragging lift, the drop indicators, the grip rest and lift)
   from the shared .reorder-row. Only the layer-specific states stay here. */
.row-main,
.facet-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
/* The lead rail reserves the handle's width so rows never reflow when the quiet handle lifts on hover.
   The handle is muted at rest and lifts to full on row hover or keyboard focus, so 25 grips do not
   shout, while staying faintly present (and tappable) for touch. */
.lead {
  display: inline-flex;
  flex-shrink: 0;
}
.trail {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: auto;
  flex-shrink: 0;
}
.tune-anchor {
  position: relative;
  display: inline-flex;
}
/* The opacity popover, anchored under the tune button at the row's trailing edge. The floating-card
   frame comes from the shared .popover-card; this only positions and sizes it. */
.tune-anchor :global(.tune-pop) {
  z-index: var(--z-menu);
  inline-size: 14rem;
  max-inline-size: calc(100vw - 1rem);
  padding: var(--space-2);
  transform-origin: right var(--anchored-origin-y, top);
}
.tune-body {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tune-body .range {
  flex: 1;
  min-inline-size: 0;
}
.tune-val {
  min-inline-size: 2.6rem;
  text-align: end;
  color: var(--text-muted);
}
/* Facet groups disclose their children inline. Chart detail repeats these controls as a larger
   editing surface, while this compact disclosure keeps everyday facet toggles one tap away. */
.facet-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
.facet-row .lead {
  min-block-size: var(--control-size);
  align-items: center;
}
.facet-stack {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
}
.facet-disclosure {
  padding-inline-start: var(--space-3);
}
.facet-presets {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-block: var(--space-2);
}
.facet-presets .segmented,
.facet-presets .btn {
  inline-size: 100%;
}
.facet-disclosure[hidden] {
  display: none;
}
.facet-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  flex-shrink: 0;
  color: var(--text-muted);
}
.facet-caret :global(svg) {
  transition: rotate var(--transition-fast);
}
.facet-caret.is-open :global(svg) {
  rotate: 90deg;
}
.facet-child {
  /* A nested child toggle is secondary, so it runs at the denser row-size line rather than the full
     control-size of a primary row, indented under the parent's title column. */
  min-block-size: var(--row-size);
}
/* The region tag: a quiet bordered pill (US, EU, Global) so a navigator sees at a glance which waters an
   overlay covers. It is metadata, not a control, so it stays muted and sits before the action rail. */
.region-tag {
  flex-shrink: 0;
  align-self: center;
  padding-inline: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.7;
}
</style>

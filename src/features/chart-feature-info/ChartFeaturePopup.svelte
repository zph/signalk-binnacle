<script lang="ts">
import X from '@lucide/svelte/icons/x';
import type { UnitsStore } from '$entities/units';
import type { ChartFeatureSelection } from '$shared/map';
import { chartFeatureDetails } from './chart-feature-info';

interface Props {
  selection: ChartFeatureSelection;
  units: UnitsStore;
  onClose: () => void;
}

const { selection, units, onClose }: Props = $props();
const details = $derived(chartFeatureDetails(selection, units.mode));

// The fixed pixel dimensions mirror the scoped CSS below. They keep the card inside the chart at
// narrow edges without measuring it after paint and moving it visibly on the next frame.
const CARD_WIDTH = 288;
const EDGE = 8;
const effectiveWidth = $derived(Math.max(0, Math.min(CARD_WIDTH, selection.width - EDGE * 2)));
const left = $derived(
  Math.min(
    Math.max(selection.x, effectiveWidth / 2 + EDGE),
    Math.max(effectiveWidth / 2 + EDGE, selection.width - effectiveWidth / 2 - EDGE),
  ),
);
const above = $derived(selection.y > selection.height / 2);
const top = $derived(above ? selection.y - EDGE : selection.y + EDGE);
const availableHeight = $derived(
  Math.max(80, above ? selection.y - EDGE * 2 : selection.height - selection.y - EDGE * 2),
);
const newest = $derived(
  details.newestAtMs === undefined
    ? undefined
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(details.newestAtMs),
      ),
);
const change = $derived(
  details.changeState && details.changeState !== 'stable'
    ? details.changeState.replaceAll('_', ' ')
    : undefined,
);
</script>

<div
  class="cell-popup popover-card"
  role="dialog"
  aria-label={`${details.title} details`}
  style={`left:${left}px;top:${top}px;--cell-available-height:${availableHeight}px;transform:translate(-50%, ${above ? '-100%' : '0'});`}
>
  <header>
    <div>
      <h2>{details.title}</h2>
      <p class="source truncate" title={selection.chartTitle}>{selection.chartTitle}</p>
    </div>
    <button
      type="button"
      class="icon-btn panel-close"
      aria-label="Close cell details"
      onclick={onClose}
    >
      <X size={18} aria-hidden="true" />
    </button>
  </header>

  {#if details.depth}
    <p class="depth"><span class="num">{details.depth}</span> {details.depthUnit}</p>
  {/if}

  <dl class="stat-grid">
    {#if details.quality}
      <dt>Data quality</dt>
      <dd><span class="num text-value">{details.quality}</span><span class="unit"></span></dd>
    {/if}
    {#if details.uncertainty}
      <dt>Uncertainty</dt>
      <dd>
        <span class="num">±{details.uncertainty}</span><span class="unit">{details.depthUnit}</span>
      </dd>
    {/if}
    {#if details.robustDepth}
      <dt>Surface estimate</dt>
      <dd>
        <span class="num">{details.robustDepth}</span><span class="unit">{details.depthUnit}</span>
      </dd>
    {/if}
    {#if details.observations !== undefined}
      <dt>Observations</dt>
      <dd><span class="num">{details.observations}</span><span class="unit"></span></dd>
    {/if}
    {#if details.soundings !== undefined}
      <dt>Source samples</dt>
      <dd><span class="num">{details.soundings}</span><span class="unit"></span></dd>
    {/if}
    {#if details.passes !== undefined}
      <dt>Independent passes</dt>
      <dd><span class="num">{details.passes}</span><span class="unit"></span></dd>
    {/if}
    {#if details.sources !== undefined}
      <dt>Depth sources</dt>
      <dd><span class="num">{details.sources}</span><span class="unit"></span></dd>
    {/if}
    {#if details.cellSize}
      <dt>Cell resolution</dt>
      <dd>
        <span class="num">{details.cellSize}</span><span class="unit">{details.depthUnit}</span>
      </dd>
    {/if}
    {#if details.datum}
      <dt>Datum</dt>
      <dd><span class="num text-value">{details.datum}</span><span class="unit"></span></dd>
    {/if}
    {#if newest}
      <dt>Newest evidence</dt>
      <dd><span class="num text-value">{newest}</span><span class="unit"></span></dd>
    {/if}
  </dl>

  {#if details.confidenceReasons.length > 0}
    <p class="muted-note muted-note--xs">Quality limits: {details.confidenceReasons.join(', ')}.</p>
  {/if}
  {#if change}
    <p class="alert-note">Seabed change state: {change}.</p>
  {/if}
  <p class="advisory muted-note muted-note--xs">
    Supplemental local estimate only. Not for primary navigation.
  </p>
</div>

<style>
.cell-popup {
  position: absolute;
  z-index: var(--z-menu);
  inline-size: min(18rem, calc(100% - 2 * var(--space-2)));
  max-block-size: min(calc(70 * var(--dvh)), 30rem, var(--cell-available-height));
  overflow: auto;
  padding: var(--space-3);
  color: var(--text);
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
header > div {
  min-inline-size: 0;
}
h2,
.source,
.depth,
.advisory {
  margin: 0;
}
h2 {
  font-size: var(--text-md);
}
.source {
  margin-block-start: 0.2rem;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.depth {
  margin-block: var(--space-2) var(--space-3);
  font-size: var(--text-readout);
}
.depth .num {
  font-weight: 700;
}
.stat-grid {
  font-size: var(--text-sm);
}
.text-value {
  white-space: normal;
}
.muted-note,
.alert-note {
  margin-block: var(--space-2) 0;
}
</style>

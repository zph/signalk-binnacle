<script lang="ts">
import Link2 from '@lucide/svelte/icons/link-2';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import Trash2 from '@lucide/svelte/icons/trash-2';
import {
  type DraftChart,
  MAX_USER_CHART_NAME_LENGTH,
  MAX_USER_CHART_URL_LENGTH,
  shouldShareUserChart,
  type UserChartSource,
  type UserCharts,
  userChartNeedsServerDelete,
  userChartUrlForDisplay,
} from '$entities/user-charts';
import { type Bbox4, formatBounds } from '$shared/geo';
import type { LayerListItem } from '$shared/map';
import type { UpgradeOutcome } from '$shared/signalk';
import {
  InlineConfirm,
  LayerToggle,
  SubViewHeader,
  TextField,
  UnavailableHint,
  WriteAccessNote,
} from '$shared/ui';
import ChartSourceReview from './ChartSourceReview.svelte';
import ChartSpecList from './ChartSpecList.svelte';
import type { LayersView } from './layers-view.svelte';

interface Props {
  item: LayerListItem;
  view: LayersView;
  subLayers?: LayerListItem[];
  userCharts?: UserCharts;
  userSource?: UserChartSource;
  writeBlocked?: boolean;
  // Ask the server for read/write access from inside the detail. The action renders only when the
  // host wires it.
  onRequestWriteAccess?: () => void;
  // A read/write request is already outstanding, so the request action reports itself and rests.
  requestingWriteAccess?: boolean;
  // How the last read and write request ended, so the outcome lands beside the button here too.
  writeOutcome?: UpgradeOutcome;
  onBack: () => void;
  onShowBounds?: (bounds: Bbox4) => void;
}

const {
  item,
  view,
  subLayers = [],
  userCharts,
  userSource,
  writeBlocked = false,
  onRequestWriteAccess,
  requestingWriteAccess = false,
  writeOutcome,
  onBack,
  onShowBounds,
}: Props = $props();

let confirming = $state(false);
// Not `name`: that shadows the global window.name, which the linter flags on reassignment.
let chartName = $derived(userSource?.name ?? item.title);
let replacementMode = $state<'idle' | 'url' | 'review'>('idle');
let replacementUrl = $state('');
let replacementDraft = $state<DraftChart | undefined>();
let replacementShare = $state(false);
let operation = $state<'reading' | 'saving' | 'sharing' | undefined>();
let operationError = $state<string | undefined>();
let operationStatus = $state<string | undefined>();
let destroyed = false;
let stageGeneration = 0;
let stageController: AbortController | undefined;

const chart = $derived(item.chart);
const MIN_LAYER_OPACITY = 0.15;
const canEdit = $derived(userSource !== undefined && userCharts !== undefined);
const renameBlocked = $derived(
  writeBlocked && userSource !== undefined && shouldShareUserChart(userSource),
);
const sourceMutationBlocked = $derived(
  writeBlocked && userSource !== undefined && userChartNeedsServerDelete(userSource),
);
// Deleting during an in-flight source write would resurrect the chart: remove() drops the overlay and
// the server resource, then the pending replace resolves and swaps the overlay back in for a chart
// that no longer exists. So a running operation blocks the delete the same way it blocks every other
// mutation in this panel.
const deleteBlocked = $derived(operation !== undefined || sourceMutationBlocked);
const chartBounds = $derived(chart?.bounds ?? userSource?.bounds);
const rawChartUrl = $derived(chart?.url ?? userSource?.origin.url);
const chartUrl = $derived(rawChartUrl ? userChartUrlForDisplay(rawChartUrl) : undefined);
const sourceShared = $derived(userSource ? shouldShareUserChart(userSource) : false);
const chartKind = $derived.by(() => {
  if (chart?.kind === 'vector') return 'Vector';
  if (chart?.kind === 'raster') return 'Raster';
  if (chart?.kind === 'style') return 'Style';
  return 'Unknown';
});
const chartOrigin = $derived(chart?.source === 'user' ? 'User-added URL chart' : 'Signal K server');
const zoom = $derived.by(() => {
  const min = chart?.minzoom ?? userSource?.minzoom ?? 0;
  const max = chart?.maxzoom ?? userSource?.maxzoom ?? min;
  return `${min} to ${max}`;
});
const specRows = $derived([
  { label: 'Name', value: item.title },
  { label: 'Type', value: chartKind },
  { label: 'Origin', value: chartOrigin },
  ...(item.region ? [{ label: 'Region', value: item.region }] : []),
  ...(chartUrl ? [{ label: 'Source', value: chartUrl }] : []),
  { label: 'Zoom', value: zoom },
  { label: 'Bounds', value: chartBounds ? formatBounds(chartBounds) : 'Unknown' },
  ...(userSource
    ? [
        {
          label: 'Stored',
          value: sourceShared ? 'This device, and shared to the server' : 'This device only',
        },
      ]
    : []),
]);
$effect(() => {
  return () => {
    destroyed = true;
    stageGeneration += 1;
    stageController?.abort(new DOMException('Chart source canceled', 'AbortError'));
    stageController = undefined;
  };
});

// An armed confirm survives a source write starting under it, and its Confirm would then press
// against a blocked delete and do nothing. Disarm instead, so the row goes back to a disabled
// Delete the navigator can see rather than a live button that silently refuses.
$effect(() => {
  if (deleteBlocked) confirming = false;
});

function saveName(): void {
  if (!canEdit || renameBlocked || !userSource || !userCharts) return;
  const trimmed = chartName.trim();
  if (trimmed && trimmed !== userSource.name) userCharts.rename(userSource.id, trimmed);
}

function doDelete(): void {
  if (deleteBlocked || !userSource || !userCharts) return;
  // Capture the id before onBack: onBack clears the panel's detail id, which can remove the live
  // userSource prop before the delete runs.
  const { id } = userSource;
  onBack();
  userCharts.remove(id);
}

function startReplacement(): void {
  if (!canEdit || sourceMutationBlocked || operation) return;
  replacementMode = 'url';
  replacementUrl = '';
  replacementDraft = undefined;
  operationError = undefined;
  operationStatus = undefined;
}

function cancelReplacement(): void {
  stageGeneration += 1;
  stageController?.abort(new DOMException('Chart source canceled', 'AbortError'));
  stageController = undefined;
  replacementMode = 'idle';
  replacementUrl = '';
  replacementDraft = undefined;
  operation = undefined;
  operationError = undefined;
}

function stageReplacement(url: string): void {
  if (!userSource || !userCharts || sourceMutationBlocked || operation) return;
  const generation = ++stageGeneration;
  stageController?.abort(new DOMException('Chart source superseded', 'AbortError'));
  const controller = new AbortController();
  stageController = controller;
  operation = 'reading';
  operationError = undefined;
  operationStatus = undefined;
  const sourceId = userSource.id;
  void userCharts
    .stageReplacement(sourceId, url, controller.signal)
    .then((draft) => {
      if (destroyed || generation !== stageGeneration) return;
      replacementDraft = draft;
      replacementShare = !writeBlocked && shouldShareUserChart(draft.source);
      replacementMode = 'review';
    })
    .catch((error: unknown) => {
      if (destroyed || generation !== stageGeneration) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      operationError =
        error instanceof Error ? error.message : 'Could not read replacement chart metadata.';
    })
    .finally(() => {
      if (!destroyed && generation === stageGeneration) operation = undefined;
      if (stageController === controller) stageController = undefined;
    });
}

function reviewReplacement(): void {
  const trimmed = replacementUrl.trim();
  if (!trimmed) return;
  stageReplacement(trimmed);
}

function refreshMetadata(): void {
  if (!userSource) return;
  stageReplacement(userSource.origin.url);
}

function saveReplacement(): void {
  const draft = replacementDraft;
  if (!draft || !userCharts || operation) return;
  operation = 'saving';
  operationError = undefined;
  operationStatus = undefined;
  void userCharts
    .replace(draft, !writeBlocked && replacementShare)
    .then(() => {
      if (destroyed) return;
      replacementMode = 'idle';
      replacementUrl = '';
      replacementDraft = undefined;
      operationStatus = 'Chart source saved.';
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      operationError =
        error instanceof Error ? error.message : 'Could not apply the replacement chart.';
    })
    .finally(() => {
      if (!destroyed) operation = undefined;
    });
}

function changeSharing(share: boolean): void {
  if (!userSource || !userCharts || writeBlocked || operation) return;
  operation = 'sharing';
  operationError = undefined;
  operationStatus = undefined;
  void userCharts
    .setSharing(userSource.id, share)
    .then(() => {
      if (destroyed) return;
      operationStatus = share
        ? 'Chart sharing saved.'
        : 'Chart now stays on this device. Removing any prior server copy continues in the background.';
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      operationError =
        error instanceof Error ? error.message : 'Could not change the chart sharing preference.';
    })
    .finally(() => {
      if (!destroyed) operation = undefined;
    });
}
</script>

<div class="detail">
  <SubViewHeader title="Chart detail" backLabel="Back to layers" {onBack} />

  {#if canEdit}
    <TextField
      variant="stacked"
      label="Name"
      value={chartName}
      ariaLabel="Chart name"
      disabled={renameBlocked}
      maxLength={MAX_USER_CHART_NAME_LENGTH}
      onCommit={(value) => {
        chartName = value;
        saveName();
      }}
    />
    {#if renameBlocked}
      <!-- The app-wide banner offers the same request, but an open panel covers it on a phone, so the
           request stays one tap away from the block it explains. -->
      <WriteAccessNote
        message="Read and write Signal K access is needed to rename this shared chart."
        requesting={requestingWriteAccess}
        onRequest={onRequestWriteAccess}
        outcome={writeOutcome}
      />
    {/if}
  {/if}

  <ChartSpecList rows={specRows} />

  <section class="panel-section" aria-label="Chart display">
    <h3 class="caps-label">Display</h3>
    <LayerToggle
      label="Show chart"
      description={`Show or hide ${item.title} on the chart`}
      visible={item.visible}
      disabled={!item.available}
      onToggle={(visible) => view.toggle(item.id, visible)}
      presentation="row"
    />

    {#if item.supportsOpacity}
      <div class="opacity-field">
        <div class="opacity-label">
          <label for={`${item.id}-detail-opacity`}>Opacity</label>
          <span class="num">{Math.round(item.opacity * 100)}%</span>
        </div>
        <div class="opacity-controls">
          <input
            id={`${item.id}-detail-opacity`}
            class="range"
            type="range"
            min={MIN_LAYER_OPACITY}
            max="1"
            step="0.05"
            value={item.opacity}
            disabled={!item.visible || !item.available}
            aria-valuetext={`${Math.round(item.opacity * 100)}%`}
            oninput={(event) =>
              view.setOpacity(item.id, Number(event.currentTarget.value), false)}
            onchange={(event) => view.setOpacity(item.id, Number(event.currentTarget.value))}
          >
          <button
            type="button"
            class="icon-btn"
            aria-label={`Reset ${item.title} opacity`}
            disabled={!item.visible || !item.available}
            onclick={() => view.setOpacity(item.id, 1)}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    {/if}

    {#if item.cellSizeControl && item.cellSizeScale !== undefined}
      <div class="cell-size-field">
        <div class="opacity-label">
          <label for={`${item.id}-detail-cell-size`}>Cell size</label>
          <span class="num">{item.cellSizeScale.toFixed(2).replace(/\.00$/, '')}×</span>
        </div>
        <p class="muted-note muted-note--xs">
          Choose whether cells appear smaller or larger relative to other items in this layer.
          Smaller values keep tighter local clusters. Larger values group nearby survey cells into
          broader shapes as you zoom out.
        </p>
        <input
          id={`${item.id}-detail-cell-size`}
          class="range"
          type="range"
          min={item.cellSizeControl.minimum}
          max={item.cellSizeControl.maximum}
          step={item.cellSizeControl.step}
          value={item.cellSizeScale}
          disabled={!item.visible || !item.available}
          aria-valuetext={`${item.cellSizeScale.toFixed(2).replace(/\.00$/, '')} times the normal cell size`}
          oninput={(event) =>
            view.setCellSizeScale(item.id, Number(event.currentTarget.value), false)}
          onchange={(event) =>
            view.setCellSizeScale(item.id, Number(event.currentTarget.value))}
        >
        <div class="cell-size-ends" aria-hidden="true">
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </div>
    {/if}

    {#if item.labelSizeControl && item.labelSizeScale !== undefined}
      <div class="cell-size-field">
        <div class="opacity-label">
          <label for={`${item.id}-detail-label-size`}>Depth label size</label>
          <span class="num">{item.labelSizeScale.toFixed(1).replace(/\.0$/, '')}×</span>
        </div>
        <p class="muted-note muted-note--xs">
          Scale the depth numbers in Binnacle without changing the underlying survey cells.
        </p>
        <input
          id={`${item.id}-detail-label-size`}
          class="range"
          type="range"
          min={item.labelSizeControl.minimum}
          max={item.labelSizeControl.maximum}
          step={item.labelSizeControl.step}
          value={item.labelSizeScale}
          disabled={!item.visible || !item.available}
          aria-valuetext={`${item.labelSizeScale.toFixed(1).replace(/\.0$/, '')} times the normal depth label size`}
          oninput={(event) =>
            view.setLabelSizeScale(item.id, Number(event.currentTarget.value), false)}
          onchange={(event) =>
            view.setLabelSizeScale(item.id, Number(event.currentTarget.value))}
        >
        <div class="cell-size-ends" aria-hidden="true">
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </div>
    {/if}

    {#if item.depthDisplayControl && item.displayDepth !== undefined}
      <div class="cell-size-field">
        <h4 class="caps-label" id={`${item.id}-depth-display-label`}>Depth display</h4>
        <div class="segmented" role="group" aria-labelledby={`${item.id}-depth-display-label`}>
          <button
            type="button"
            class="btn"
            class:is-on={item.displayDepth === 'conservative'}
            aria-pressed={item.displayDepth === 'conservative'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setDisplayDepth(item.id, 'conservative')}
          >
            Conservative
          </button>
          <button
            type="button"
            class="btn"
            class:is-on={item.displayDepth === 'predicted'}
            aria-pressed={item.displayDepth === 'predicted'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setDisplayDepth(item.id, 'predicted')}
          >
            Predicted
          </button>
        </div>
      </div>
    {/if}

    {#if item.depthDisplayControl && item.cellPortrayal !== undefined}
      <div class="cell-size-field">
        <h4 class="caps-label" id={`${item.id}-cell-portrayal-label`}>Depth label style</h4>
        <div class="segmented" role="group" aria-labelledby={`${item.id}-cell-portrayal-label`}>
          <button
            type="button"
            class="btn"
            class:is-on={item.cellPortrayal === 'shaded'}
            aria-pressed={item.cellPortrayal === 'shaded'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setCellPortrayal(item.id, 'shaded')}
          >
            White halo
          </button>
          <button
            type="button"
            class="btn"
            class:is-on={item.cellPortrayal === 'text'}
            aria-pressed={item.cellPortrayal === 'text'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setCellPortrayal(item.id, 'text')}
          >
            Black text
          </button>
        </div>
        <p class="muted-note muted-note--xs">
          White halo puts a bright backdrop behind the depth numbers for contrast over busy charts.
          Black text drops the halo so the numbers blend into the chart. Depth shading and cell
          outlines stay in both styles.
        </p>
      </div>
    {/if}

    {#if item.depthDisplayControl && item.bathymetryColorScheme !== undefined}
      <div class="cell-size-field">
        <h4 class="caps-label" id={`${item.id}-bathymetry-color-label`}>Depth colors</h4>
        <div class="segmented" role="group" aria-labelledby={`${item.id}-bathymetry-color-label`}>
          <button
            type="button"
            class="btn"
            class:is-on={item.bathymetryColorScheme === 'safety'}
            aria-pressed={item.bathymetryColorScheme === 'safety'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setBathymetryColorScheme(item.id, 'safety')}
          >
            Safety
          </button>
          <button
            type="button"
            class="btn"
            class:is-on={item.bathymetryColorScheme === 'noaa-chart'}
            aria-pressed={item.bathymetryColorScheme === 'noaa-chart'}
            disabled={!item.visible || !item.available}
            onclick={() => view.setBathymetryColorScheme(item.id, 'noaa-chart')}
          >
            NOAA chart
          </button>
        </div>
        <p class="muted-note muted-note--xs">
          Safety colors follow your safety depth. NOAA chart uses fixed shallow-to-deep blue bands.
        </p>
      </div>
    {/if}

    {#if subLayers.length > 0}
      <div class="chart-layer-list" role="group" aria-label={`${item.title} chart layers`}>
        <h4 class="caps-label">Chart layers</h4>
        {#each subLayers as sub (sub.id)}
          {@const unavailableId = `chart-layer-${sub.id}-unavailable`}
          <div
            class="chart-layer-row"
            class:unavailable={!sub.available}
            title={sub.available ? undefined : sub.unavailableHint}
          >
            <UnavailableHint
              id={unavailableId}
              hint={sub.available ? undefined : sub.unavailableHint}
            />
            <LayerToggle
              label={sub.title}
              description={sub.description}
              visible={sub.visible}
              disabled={!item.available || !item.visible || !sub.available}
              describedBy={!sub.available && sub.unavailableHint ? unavailableId : undefined}
              onToggle={(visible) => view.toggle(sub.id, visible)}
              presentation="row"
            />
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if !item.available && item.unavailableHint}
    <p class="muted-note" role="status">{item.unavailableHint}</p>
  {/if}

  {#if chartBounds}
    <button type="button" class="btn" onclick={() => onShowBounds?.(chartBounds)}>
      <LocateFixed size={16} aria-hidden="true" />
      Show chart area
    </button>
  {/if}

  {#if canEdit}
    <section class="panel-section" aria-label="Chart source maintenance">
      <h3 class="caps-label">Source maintenance</h3>
      <p class="muted-note">
        Repair a moved or expired PMTiles link without losing this chart's visibility, opacity, or
        stacking position.
      </p>

      {#if replacementMode === 'idle'}
        <div class="panel-controls">
          <button
            type="button"
            class="btn"
            onclick={startReplacement}
            disabled={sourceMutationBlocked || operation !== undefined}
          >
            <Link2 size={16} aria-hidden="true" />
            Replace source URL
          </button>
          <button
            type="button"
            class="btn"
            onclick={refreshMetadata}
            disabled={sourceMutationBlocked || operation !== undefined}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh metadata
          </button>
        </div>

        {#if userSource}
          <ChartSourceReview
            source={userSource}
            shareWithServer={sourceShared}
            {writeBlocked}
            disabled={operation !== undefined}
            showSpecs={false}
            onShareChange={changeSharing}
          />
        {/if}
      {:else if replacementMode === 'url'}
        <div class="replacement-editor" role="group" aria-label="Replace chart source URL">
          <TextField
            variant="stacked"
            label="Replacement URL"
            value={replacementUrl}
            placeholder="https://.../chart.pmtiles"
            disabled={operation !== undefined}
            maxLength={MAX_USER_CHART_URL_LENGTH}
            focusOnOpen
            onInput={(value) => (replacementUrl = value)}
            onCommit={(value) => (replacementUrl = value)}
            onEnter={reviewReplacement}
          />
          <p class="muted-note">
            The current URL remains active until the replacement metadata is reviewed and saved.
          </p>
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary"
              onclick={reviewReplacement}
              disabled={operation !== undefined || !replacementUrl.trim()}
            >
              Review replacement
            </button>
            <button
              type="button"
              class="btn"
              onclick={cancelReplacement}
              disabled={operation === 'saving' || operation === 'sharing'}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else if replacementDraft}
        <div class="replacement-editor" role="group" aria-label="Review replacement chart">
          <h4 class="caps-label">Review replacement</h4>
          <ChartSourceReview
            source={replacementDraft.source}
            shareWithServer={replacementShare}
            {writeBlocked}
            disabled={operation !== undefined}
            showSource
            onShareChange={(share) => (replacementShare = share)}
          />
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary"
              onclick={saveReplacement}
              disabled={operation !== undefined}
            >
              Save replacement
            </button>
            <button
              type="button"
              class="btn"
              onclick={cancelReplacement}
              disabled={operation !== undefined}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}

      {#if operation === 'reading'}
        <p class="muted-note" role="status">Reading replacement chart…</p>
      {:else if operation === 'saving'}
        <p class="muted-note" role="status">Saving replacement chart…</p>
      {:else if operation === 'sharing'}
        <p class="muted-note" role="status">Saving chart sharing…</p>
      {:else if operationError}
        <p class="alert-note" role="alert">{operationError}</p>
      {:else if operationStatus}
        <p class="muted-note" role="status">{operationStatus}</p>
      {/if}

      {#if sourceMutationBlocked}
        <p class="muted-note" role="status">
          Read and write Signal K access is needed to repair or refresh this shared chart.
        </p>
      {:else if writeBlocked}
        <p class="muted-note" role="status">
          This device-only chart can be repaired locally. Read and write Signal K access is needed
          to share it.
        </p>
      {/if}
    </section>

    {#if writeBlocked && userSource?.serverCleanupRequired}
      <!-- A prerequisite, not an alarm: it teaches what is missing before the delete can finish, so
        it takes the quiet note styling that matches its polite announcement. -->
      <p class="muted-note" role="status">
        Read and write Signal K access is needed to remove the remaining server copy before deleting
        this chart from the device.
      </p>
    {/if}
    {#if confirming}
      <InlineConfirm
        question="Delete this chart?"
        onConfirm={doDelete}
        onCancel={() => (confirming = false)}
      />
    {:else}
      <button
        type="button"
        class="btn btn-danger"
        onclick={() => (confirming = true)}
        disabled={deleteBlocked}
      >
        <Trash2 size={16} aria-hidden="true" />
        Delete chart
      </button>
    {/if}
  {/if}
</div>

<style>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.replacement-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.opacity-field,
.cell-size-field,
.chart-layer-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.opacity-label,
.opacity-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.opacity-label {
  justify-content: space-between;
  color: var(--text-muted);
}
.opacity-controls .range {
  flex: 1;
  min-inline-size: 0;
}
.cell-size-ends {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.chart-layer-row {
  display: flex;
}
</style>

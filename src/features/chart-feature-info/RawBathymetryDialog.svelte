<script lang="ts">
import X from '@lucide/svelte/icons/x';
import { onMount } from 'svelte';
import type { DepthUnit } from '$entities/units';
import { formatFixed, metersToFeet } from '$shared/lib';
import { dialog } from '$shared/ui';
import { type BathymetrySounding, fetchBathymetrySoundings } from './bathymetry-soundings-client';

interface Props {
  origin: string;
  token?: string;
  latitude: number;
  longitude: number;
  depthUnit: DepthUnit;
  onClose: () => void;
}

const { origin, token, latitude, longitude, depthUnit, onClose }: Props = $props();
let rows = $state<BathymetrySounding[]>([]);
let loadState = $state<'loading' | 'ready' | 'error'>('loading');
const sourceSamples = $derived(rows.reduce((sum, row) => sum + row.sampleCount, 0));

onMount(() => {
  let active = true;
  void fetchBathymetrySoundings(origin, token, latitude, longitude).then((result) => {
    if (!active) return;
    if (result === undefined) {
      loadState = 'error';
      return;
    }
    rows = result;
    loadState = 'ready';
  });
  return () => {
    active = false;
  };
});

function depth(meters: number): string {
  const value =
    depthUnit === 'ft' ? metersToFeet(meters) : depthUnit === 'fm' ? meters / 1.8288 : meters;
  return formatFixed(value, 1);
}

function observedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(
    new Date(value),
  );
}
</script>

<dialog class="modal-card raw-dialog" aria-label="Raw bathymetry data" use:dialog={onClose}>
  <header class="dialog-header raw-header">
    <div>
      <h2>Raw bathymetry data</h2>
      <p class="muted-note muted-note--xs">Source records located inside the selected cell.</p>
    </div>
    <button type="button" class="icon-btn" aria-label="Close raw bathymetry data" onclick={onClose}>
      <X size={19} aria-hidden="true" />
    </button>
  </header>

  <div class="dialog-body raw-body">
    {#if loadState === 'loading'}
      <p class="muted-note" role="status">Loading source records…</p>
    {:else if loadState === 'error'}
      <p class="alert-note" role="alert">
        Raw source records could not be loaded from the bathymetry plugin.
      </p>
    {:else if rows.length === 0}
      <p class="muted-note">No source records were returned for this cell.</p>
    {:else}
      <p class="record-count">
        <span class="num">{rows.length.toLocaleString()}</span>
        source record{rows.length === 1 ? '' : 's'},
        <span class="num">{sourceSamples.toLocaleString()}</span>
        source sample{sourceSamples === 1 ? '' : 's'}
      </p>
      <div class="table-scroll">
        <table>
          <caption class="visually-hidden">
            Raw bathymetry source records
          </caption>
          <thead>
            <tr>
              <th scope="col">Observed</th>
              <th scope="col">Position</th>
              <th scope="col">Datum depth</th>
              <th scope="col">Raw depth</th>
              <th scope="col">Tide</th>
              <th scope="col">Uncertainty</th>
              <th scope="col">Samples</th>
              <th scope="col">QC</th>
              <th scope="col">Source</th>
              <th scope="col">Aggregation</th>
              <th scope="col">Pass</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.id)}
              <tr>
                <td>{observedAt(row.observedAt)}</td>
                <td class="numeric">
                  {row.position.latitude.toFixed(6)}, {row.position.longitude.toFixed(6)}
                </td>
                <td class="numeric">{depth(row.datumDepthM)} {depthUnit}</td>
                <td class="numeric">{depth(row.rawDepthM)} {depthUnit}</td>
                <td class="numeric">{depth(row.tideHeightM)} {depthUnit}</td>
                <td class="numeric">±{depth(row.verticalSigmaM)} {depthUnit}</td>
                <td class="numeric">{row.sampleCount}</td>
                <td><span class:qc-warning={row.qcState !== 'accepted'}>{row.qcState}</span></td>
                <td>{row.depthSource}</td>
                <td>{row.aggregationKind.replaceAll('_', ' ')}</td>
                <td>{row.passId}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <footer class="dialog-footer">
    <button type="button" class="btn btn-primary" onclick={onClose}>Done</button>
  </footer>
</dialog>

<style>
.raw-dialog {
  inline-size: min(72rem, calc(100dvw - 2 * var(--space-4)));
  max-block-size: calc(100dvh - 2 * var(--space-4));
}
.raw-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.raw-header p,
.record-count {
  margin: 0;
}
.raw-body {
  min-block-size: 12rem;
  overflow: hidden;
}
.record-count {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.table-scroll {
  max-block-size: min(65dvh, 38rem);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
table {
  inline-size: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  white-space: nowrap;
}
th,
td {
  padding: var(--space-2);
  border-block-end: 1px solid var(--border);
  text-align: start;
}
th {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.numeric {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: end;
}
.qc-warning {
  color: var(--warning);
}
@media (max-width: 36rem) {
  .raw-dialog {
    inline-size: calc(100dvw - 2 * var(--space-2));
    max-block-size: calc(100dvh - 2 * var(--space-2));
  }
}
</style>

<script lang="ts">
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Download from '@lucide/svelte/icons/download';
import Eraser from '@lucide/svelte/icons/eraser';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import Route from '@lucide/svelte/icons/route';
import Save from '@lucide/svelte/icons/save';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Undo2 from '@lucide/svelte/icons/undo-2';
import {
  hasDrawableTrack,
  hasTrackGaps,
  latestTrackSegment,
  type TrackRecorder,
} from '$entities/track';
import {
  formatDuration,
  formatKnots,
  formatNm,
  formatSignedAngleOr,
  PLACEHOLDER,
  type ReactiveClock,
} from '$shared/lib';
import {
  type PersistedValue,
  preferTrackHistory,
  type TrackSettings,
  trackStopDurationMinutes,
  trackStopSpeedKnots,
  tripLogEnabled,
  useLocalTrackFallback,
} from '$shared/settings';
import { type AuthController, resourcesProviderNote } from '$shared/signalk';
import {
  ArmedRow,
  createPanelMinimize,
  defaultSaveName,
  InlineConfirm,
  LayerToggle,
  NameEntry,
  resolveSaveName,
  SavedList,
  SlideOver,
  UnitField,
  VisibilityToggle,
  WriteAccessNote,
} from '$shared/ui';
import type { TrackLoadState, TracksProvisioning } from './track-controller.svelte';
import type { SavedTrack } from './tracks-client';
import type { TripLogController } from './trip-log-controller.svelte';

interface Props {
  auth: AuthController;
  recorder: TrackRecorder;
  // Whether the shell is currently feeding the recorder: stale or missing GPS keeps every fix out
  // of consider(), so an armed recorder is waiting, not recording.
  positionStale: boolean;
  hasPosition: boolean;
  clock: ReactiveClock;
  settings: PersistedValue<TrackSettings>;
  tripLog: TripLogController;
  saved: SavedTrack[];
  shown: ReadonlySet<string>;
  loadState: TrackLoadState;
  // Whether the server has a tracks resource provider at all, which is why a save can fail on a
  // server that is otherwise reachable and authorized.
  provisioning: TracksProvisioning;
  busy: boolean;
  routeBusy: boolean;
  persistenceDegraded: boolean;
  historyProviderState: 'checking' | 'retrying' | 'available' | 'absent' | 'failed';
  onRetry: () => void;
  // Resolves whether the write succeeded, so a failure keeps the name form and its entered value.
  onSave: (name: string) => Promise<boolean>;
  // Save the current track as a reusable route, and navigate back along it (retrace home).
  onSaveAsRoute: (name: string) => Promise<boolean>;
  onTrackHome: () => void;
  onDelete: (id: string) => void;
  onToggleSaved: (id: string, shown: boolean) => void;
  onExport: (track: SavedTrack) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  recorder,
  positionStale,
  hasPosition,
  clock,
  settings,
  tripLog,
  saved,
  shown,
  loadState,
  provisioning,
  busy,
  routeBusy,
  persistenceDegraded,
  historyProviderState,
  onRetry,
  onSave,
  onSaveAsRoute,
  onTrackHome,
  onDelete,
  onToggleSaved,
  onExport,
  onClose,
  onBack,
}: Props = $props();

const stats = $derived(recorder.stats);
const colorMode = $derived(settings.value.colorMode);
const intervalSeconds = $derived(settings.value.intervalSeconds);
const minMeters = $derived(settings.value.minMeters);
const historyPreferred = $derived(preferTrackHistory(settings.value));
const historyAvailable = $derived(historyProviderState === 'available');
const localFallback = $derived(useLocalTrackFallback(settings.value));
const localRecordingActive = $derived(
  !historyPreferred ||
    (!historyAvailable &&
      historyProviderState !== 'checking' &&
      historyProviderState !== 'retrying' &&
      localFallback),
);
const stopSpeedKnots = $derived(trackStopSpeedKnots(settings.value));
const stopDurationMinutes = $derived(trackStopDurationMinutes(settings.value));
const tripEnabled = $derived(tripLogEnabled(settings.value));
// Until the track has captured a point, its stats are absent, not zero, so show the placeholder.
const hasTrack = $derived(recorder.points.length > 0);

// An armed recorder with stale or missing GPS accepts no points: that is waiting, not recording.
const waitingForGps = $derived(!recorder.paused && (positionStale || !hasPosition));
const lastAccepted = $derived(recorder.points[recorder.points.length - 1]);
const lastAcceptedAge = $derived.by(() => {
  if (!lastAccepted) return '';
  const seconds = Math.max(0, Math.round((clock.now - lastAccepted.t) / 1000));
  return seconds < 90 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
});
// The latest segment began with a gap recently: name the break so the trail is not mistaken for
// a continuous line back through the outage.
const RECENT_SEGMENT_MS = 10 * 60_000;
const resumedNewSegment = $derived.by(() => {
  const points = recorder.points;
  for (let i = points.length - 1; i > 0; i -= 1) {
    if (points[i].gap) return clock.now - points[i].t <= RECENT_SEGMENT_MS;
  }
  return false;
});
const canSaveTrack = $derived(hasDrawableTrack(recorder.points));
const canMakeRoute = $derived(latestTrackSegment(recorder.points).length >= 2);
const trackHasGaps = $derived(hasTrackGaps(recorder.points));
const storageMissing = $derived(provisioning === 'unprovisioned');
const writesDisabled = $derived(auth.writeBlocked || busy);
const routeActionsDisabled = $derived(auth.writeBlocked || busy || routeBusy || !canMakeRoute);
const minimize = createPanelMinimize();

// Each saved track's distance and duration, formatted once per change. They ride on the SavedTrack as
// SI metadata saved with the geometry, so the card reads them without re-walking the points; a track
// saved without them shows the placeholder.
const savedCards = $derived(
  saved.map((track) => ({
    track,
    distanceNm: track.distanceMeters == null ? PLACEHOLDER : formatNm(track.distanceMeters),
    durationText:
      track.durationSeconds == null ? PLACEHOLDER : formatDuration(track.durationSeconds),
  })),
);

// An empty saved list means something different in each state: still reading, failed, nowhere to
// read from, or genuinely nothing saved yet.
function savedEmptyMessage(state: TrackLoadState, missingStorage: boolean): string {
  if (state === 'loading') return 'Loading saved tracks…';
  if (state === 'error') return 'Saved tracks are unavailable.';
  if (missingStorage) return 'Saved tracks are unavailable until this server has track storage.';
  return 'No saved tracks yet. Record a track, then tap Save to keep it.';
}

const savedEmptyText = $derived(savedEmptyMessage(loadState, storageMissing));

// Naming a save happens inline through NameEntry rather than a native prompt; one state drives both
// the Save and the Save-as-route flows, so only one name form is open at a time.
let naming = $state<'track' | 'route' | null>(null);
let savingName = $state(false);
// The form closes only once the write is accepted. Closing it on submit discarded the name the
// navigator typed the moment a save failed, which is exactly when it is worth keeping: the failure
// itself is reported on the app-wide toast, so there would be nothing left to retry from.
async function confirmName(value: string): Promise<boolean> {
  if (savingName) return false;
  const target = naming;
  if (!target) return false;
  const trimmed = resolveSaveName(value, target === 'route' ? 'Route' : 'Track');
  savingName = true;
  try {
    const ok = target === 'track' ? await onSave(trimmed) : await onSaveAsRoute(trimmed);
    if (ok) naming = null;
    return ok;
  } finally {
    savingName = false;
  }
}

// Discarding the live recording is destructive, so it arms the same inline confirm as the
// saved-track delete rather than a blocking window.confirm.
let confirmingClear = $state(false);
let confirmingRetrace = $state(false);
function confirmRetrace(): void {
  confirmingRetrace = false;
  onTrackHome();
  // The Locate idiom: the chart and the new guidance strip are the point once navigation starts.
  minimize.collapse();
}
function confirmClear(): void {
  confirmingClear = false;
  recorder.clear();
}

// Deleting a saved track is destructive, so it arms a confirm step rather than firing on a
// single tap where a mis-tap on a rolling deck would lose a saved track.
const armedDelete = new ArmedRow((id) => onDelete(id));

function setColorMode(mode: TrackSettings['colorMode']): void {
  settings.set({ ...settings.value, colorMode: mode });
}

function setIntervalSeconds(value: number): void {
  settings.set({ ...settings.value, intervalSeconds: Math.min(3_600, Math.max(1, value)) });
}

function setMinMeters(value: number): void {
  settings.set({ ...settings.value, minMeters: Math.min(10_000, Math.max(1, value)) });
}

function setHistoryPreferred(preferred: boolean): void {
  settings.set({ ...settings.value, preferHistory: preferred });
}

function setTripEnabled(enabled: boolean): void {
  settings.set({ ...settings.value, tripLogEnabled: enabled });
}

function selectTripDate(event: Event): void {
  const value = (event.currentTarget as HTMLInputElement).value;
  if (value) void tripLog.selectDate(value);
}

function setLocalFallback(enabled: boolean): void {
  settings.set({ ...settings.value, localFallback: enabled });
}

function setStopSpeedKnots(value: number): void {
  settings.set({ ...settings.value, stopSpeedKnots: Math.min(5, Math.max(0, value)) });
}

function setStopDurationMinutes(value: number): void {
  settings.set({ ...settings.value, stopDurationMinutes: Math.min(1_440, Math.max(1, value)) });
}
</script>

<SlideOver title="Tracks" closeLabel="Close tracks panel" bodyFlex {onClose} {onBack} {minimize}>
  {#if auth.writeBlocked}
    <WriteAccessNote
      message="This display has read-only access, so tracks cannot be saved or deleted. Request read and write access; the boat's Signal K admin approves it."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}
  {#if storageMissing}
    <p class="alert-note" role="alert">
      {resourcesProviderNote(
        'This Signal K server has no track storage, so tracks cannot be saved to it.',
        'add tracks under Resources (custom)',
      )}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Check again</button>
  {/if}
  {#if persistenceDegraded && localRecordingActive}
    <p class="alert-note" role="alert">
      {storageMissing
        ? 'Track storage is memory-only. The current track will be lost on reload. Saving to the server is unavailable until track storage is enabled there.'
        : 'Track storage is memory-only. The current track will be lost on reload. Save it to the server before leaving.'}
    </p>
  {/if}
  <p class="muted-note">
    Signal K history is the primary breadcrumb trail. It survives browser reloads and Binnacle
    updates without saving a duplicate track. Named saves remain available for sharing or reuse.
  </p>
  <section class="panel-section trip-log" aria-label="Trip log">
    <div class="section-heading-row">
      <h3 class="caps-label">Trip log</h3>
      <LayerToggle label="Show on chart" visible={tripEnabled} onToggle={setTripEnabled} />
    </div>
    {#if tripEnabled}
      <div class="day-controls" role="group" aria-label="Trip day">
        <button
          type="button"
          class="icon-btn"
          aria-label="Previous trip day"
          title="Previous day"
          onclick={tripLog.previousDay}
          disabled={tripLog.status === 'loading'}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <input
          class="date-input"
          type="date"
          aria-label="Trip date"
          value={tripLog.selectedDate}
          max={tripLog.today}
          onchange={selectTripDate}
        >
        <button
          type="button"
          class="icon-btn"
          aria-label="Next trip day"
          title="Next day"
          onclick={tripLog.nextDay}
          disabled={tripLog.status === 'loading' || tripLog.selectedDate >= tripLog.today}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      {#if tripLog.status === 'loading'}
        <p class="muted-note" role="status">Loading trip day…</p>
      {:else if tripLog.status === 'unavailable'}
        <p class="alert-note" role="alert">Trip log needs a Signal K history provider.</p>
      {:else if tripLog.status === 'error'}
        <p class="alert-note" role="alert">Trip history could not be loaded.</p>
        <button type="button" class="btn btn-ghost" onclick={tripLog.refresh}>Try again</button>
      {:else if tripLog.day && !tripLog.day.hasTravel}
        <p class="muted-note" role="status">No travel over {stopSpeedKnots} kn on this day.</p>
      {:else if tripLog.day}
        <p class="muted-note muted-note--xs">
          {tripLog.day.portions.length}
          {tripLog.day.portions.length === 1 ? 'travel portion' : 'travel portions'}
          and
          {tripLog.day.stops.length} {tripLog.day.stops.length === 1 ? 'stop' : 'stops'}.
        </p>
        <div class="portion-list">
          {#each tripLog.day.portions as portion, index (portion.id)}
            <article class="portion-card">
              <span class="portion-number" aria-hidden="true">{index + 1}</span>
              <dl>
                <div>
                  <dt>Average speed</dt>
                  <dd><span class="num">{formatKnots(portion.averageSpeedMps)}</span> kn</dd>
                </div>
                <div>
                  <dt>Average wind angle</dt>
                  <dd>
                    <span class="num">{formatSignedAngleOr(portion.averageWindAngleRad)}</span>
                    {portion.averageWindAngleRad === undefined ? '' : '°'}
                  </dd>
                </div>
              </dl>
              <span class="duration-tag">{formatDuration(portion.durationSeconds)}</span>
            </article>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
  <section class="panel-section" aria-label="Track source">
    <h3 class="caps-label">Track source</h3>
    <div class="source-mode segmented" role="group" aria-label="Track source">
      <button
        type="button"
        class="btn"
        class:is-on={historyPreferred}
        aria-pressed={historyPreferred}
        onclick={() => setHistoryPreferred(true)}
      >
        Signal K history
      </button>
      <button
        type="button"
        class="btn"
        class:is-on={!historyPreferred}
        aria-pressed={!historyPreferred}
        onclick={() => setHistoryPreferred(false)}
      >
        Local recording
      </button>
    </div>
    {#if historyProviderState === 'checking' || historyProviderState === 'retrying'}
      <p class="muted-note" role="status">Checking for position history on Signal K…</p>
    {:else if historyPreferred && historyAvailable}
      <p class="muted-note status" role="status">
        Using Signal K history. No duplicate local recording is needed.
      </p>
    {:else if historyPreferred && localFallback}
      <p class="muted-note status" role="status">
        Signal K history is unavailable. Recording locally as the configured fallback.
      </p>
    {:else if historyPreferred}
      <p class="alert-note" role="alert">
        Signal K history is unavailable, and local fallback is off.
      </p>
    {/if}
    <LayerToggle
      label="Record locally when history is unavailable"
      visible={localFallback}
      onToggle={setLocalFallback}
    />
  </section>

  {#if historyPreferred}
    <section class="panel-section" aria-label="Stop detection">
      <h3 class="caps-label">Stops</h3>
      <UnitField
        label="Below"
        unit="kn"
        value={stopSpeedKnots}
        min={0}
        max={5}
        step={0.05}
        onCommit={setStopSpeedKnots}
      />
      <UnitField
        label="Longer than"
        unit="min"
        value={stopDurationMinutes}
        min={1}
        max={1440}
        step={1}
        onCommit={setStopDurationMinutes}
      />
      <p class="muted-note muted-note--xs">
        Stops appear on the historical track with their duration.
      </p>
    </section>
  {/if}

  {#if localRecordingActive}
    <p
      class="muted-note status"
      class:status--on={!recorder.paused && !waitingForGps}
      role="status"
    >
      {recorder.paused
        ? 'Paused local recording'
        : waitingForGps
          ? lastAccepted
            ? `Waiting for fresh GPS. Last accepted fix ${lastAcceptedAge}. Recording resumes automatically.`
            : 'Waiting for fresh GPS. Recording starts automatically.'
          : 'Recording locally'}
    </p>
    {#if !recorder.paused && !waitingForGps && resumedNewSegment}
      <p class="muted-note" role="status">Recording resumed as a new segment after a GPS gap.</p>
    {/if}
    <div class="panel-controls">
      {#if recorder.paused}
        <button type="button" class="btn" onclick={() => recorder.resume()}>
          <Play size={16} aria-hidden="true" />
          Resume
        </button>
      {:else}
        <button type="button" class="btn" onclick={() => recorder.pause()}>
          <Pause size={16} aria-hidden="true" />
          Pause
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => (naming = 'track')}
        disabled={!canSaveTrack || writesDisabled || storageMissing}
      >
        <Save size={16} aria-hidden="true" />
        Save
      </button>
      <button
        type="button"
        class="btn btn-danger"
        onclick={() => (confirmingClear = true)}
        disabled={recorder.points.length === 0 || busy}
      >
        <Eraser size={16} aria-hidden="true" />
        Discard
      </button>
    </div>
    {#if naming === 'track'}
      <NameEntry
        label="Save track as"
        value={defaultSaveName('Track')}
        onConfirm={confirmName}
        busy={savingName}
        onCancel={() => (naming = null)}
      />
    {/if}
    {#if confirmingClear}
      <InlineConfirm
        question="Discard the current track? This cannot be undone."
        confirmLabel="Discard"
        onConfirm={confirmClear}
        onCancel={() => (confirmingClear = false)}
      />
    {/if}

    <section class="panel-section" aria-label="Local recorder settings">
      <h3 class="caps-label">Local recorder</h3>
      <UnitField
        label="Sample interval"
        unit="s"
        value={intervalSeconds}
        min={1}
        max={3600}
        step={1}
        onCommit={setIntervalSeconds}
      />
      <UnitField
        label="Minimum movement"
        unit="m"
        value={minMeters}
        min={1}
        max={10000}
        step={1}
        onCommit={setMinMeters}
      />
      <h4 class="caps-label">Track color</h4>
      <div class="color-mode segmented" role="group" aria-label="Track color">
        <button
          type="button"
          class="btn"
          class:is-on={colorMode === 'speed'}
          aria-pressed={colorMode === 'speed'}
          onclick={() => setColorMode('speed')}
        >
          Speed
        </button>
        <button
          type="button"
          class="btn"
          class:is-on={colorMode === 'solid'}
          aria-pressed={colorMode === 'solid'}
          onclick={() => setColorMode('solid')}
        >
          One color
        </button>
      </div>
    </section>

    <div class="panel-controls">
      <button
        type="button"
        class="btn"
        onclick={() => (naming = 'route')}
        disabled={routeActionsDisabled}
      >
        <Route size={16} aria-hidden="true" />
        Save as route
      </button>
      <button
        type="button"
        class="btn"
        onclick={() => (confirmingRetrace = true)}
        disabled={routeActionsDisabled}
      >
        <Undo2 size={16} aria-hidden="true" />
        Retrace track
      </button>
    </div>
    {#if naming === 'route'}
      <NameEntry
        label="Save as route"
        value={defaultSaveName('Route')}
        onConfirm={confirmName}
        busy={savingName}
        onCancel={() => (naming = null)}
      />
    {/if}
    {#if confirmingRetrace}
      <InlineConfirm
        question="Start navigation back along the latest continuous track segment? Check the route before relying on it."
        confirmLabel="Start retrace"
        onConfirm={confirmRetrace}
        onCancel={() => (confirmingRetrace = false)}
      />
    {/if}
    <p class="muted-note">
      Save keeps the track. Save as route makes a reusable route you can follow again. Retrace track
      navigates back the way you came.
    </p>
    {#if trackHasGaps}
      <p class="muted-note">
        GPS gaps split this track. Route actions use only the latest continuous segment. Saving the
        track keeps all segments.
      </p>
    {:else if hasTrack && !canMakeRoute}
      <p class="muted-note">Record at least two connected points to save or retrace a route.</p>
    {/if}

    <section class="panel-section" aria-label="Current track">
      <h3 class="caps-label">Current track</h3>
      <p class="muted-note">
        {recorder.points.length} {recorder.points.length === 1 ? 'point' : 'points'}
      </p>
      <dl class="stat-grid">
        <dt>Distance</dt>
        <dd>
          <span class="num">{hasTrack ? formatNm(stats.distanceMeters) : PLACEHOLDER}</span>
          <span class="unit">nm</span>
        </dd>
        <dt>Duration</dt>
        <dd>
          <span class="num">{hasTrack ? formatDuration(stats.durationSeconds) : PLACEHOLDER}</span>
          <span class="unit"></span>
        </dd>
        <dt>Avg speed</dt>
        <dd>
          <span class="num">{hasTrack ? formatKnots(stats.avgSog) : PLACEHOLDER}</span>
          <span class="unit">kn</span>
        </dd>
        <dt>Top speed</dt>
        <dd>
          <span class="num">{hasTrack ? formatKnots(stats.maxSog) : PLACEHOLDER}</span>
          <span class="unit">kn</span>
        </dd>
      </dl>
    </section>
  {/if}

  {#if loadState === 'error'}
    <p class="alert-note" role="alert">
      {saved.length > 0
        ? 'Could not refresh saved tracks. Showing the last loaded tracks.'
        : 'Could not load saved tracks. Check the connection, then retry.'}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry saved tracks</button>
  {:else if loadState === 'loading' && saved.length > 0}
    <p class="muted-note" role="status">Refreshing saved tracks…</p>
  {/if}
  <SavedList
    heading="Saved tracks"
    items={savedCards}
    empty={savedEmptyText}
    key={({ track }) => track.id}
  >
    {#snippet card({ track, distanceNm, durationText })}
      <div class="card-head">
        <span class="name" title={track.name}>{track.name}</span>
      </div>
      <dl class="card-stats">
        <dt class="caps-label">Distance</dt>
        <dd>
          <span class="num">{distanceNm}</span>
          nm
        </dd>
        <dt class="caps-label">Duration</dt>
        <dd><span class="num">{durationText}</span></dd>
      </dl>
      {#if armedDelete.isArmed(track.id)}
        <InlineConfirm
          question="Delete this track?"
          onConfirm={() => armedDelete.confirm(track.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          <VisibilityToggle
            visible={shown.has(track.id)}
            onToggle={(v) => onToggleSaved(track.id, v)}
          />
          <button
            type="button"
            class="icon-btn"
            aria-label="Download track file"
            title="Download track file (.geojson)"
            onclick={() => onExport(track)}
          >
            <Download size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete track"
            title="Delete"
            onclick={() => armedDelete.arm(track.id)}
            disabled={writesDisabled}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      {/if}
    {/snippet}
  </SavedList>
</SlideOver>

<style>
/* The segment join comes from the global .segmented treatment; only the equal segment widths and
   the off-segment quiet fill are local. */
.color-mode .btn,
.source-mode .btn {
  flex: 1;
}
/* The recording-state line: muted while paused, accented while a track is being captured. */
.status--on {
  color: var(--accent);
  font-weight: 600;
}
.section-heading-row,
.day-controls,
.portion-card,
.portion-card dl,
.portion-card dl > div {
  display: flex;
  align-items: center;
}
.section-heading-row {
  justify-content: space-between;
  gap: var(--space-2);
}
.section-heading-row :global(.layer-toggle) {
  margin: 0;
}
.day-controls {
  justify-content: center;
  gap: var(--space-2);
}
.date-input {
  min-block-size: var(--control-size);
  color: var(--text);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding-inline: var(--space-2);
  color-scheme: dark;
}
.portion-list {
  display: grid;
  gap: var(--space-2);
}
.portion-card {
  position: relative;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.portion-number {
  display: grid;
  place-items: center;
  inline-size: 1.5rem;
  block-size: 1.5rem;
  flex: 0 0 auto;
  border-radius: 50%;
  color: var(--surface);
  background: var(--accent);
  font: 700 var(--text-xs) var(--font-ui);
}
.portion-card dl {
  flex: 1;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: 0;
}
.portion-card dl > div {
  gap: var(--space-1);
}
.portion-card dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.portion-card dd {
  margin: 0;
}
.duration-tag {
  align-self: flex-start;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
/* The current-track stats use the global .stat-grid system in app.css. */
/* The saved-track card list, name, stats, and actions come from the global .saved system in app.css. */
/* The armed confirms (saved-track delete, live-track discard) come from the shared InlineConfirm
   component. */
</style>

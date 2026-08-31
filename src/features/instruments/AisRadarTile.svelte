<script lang="ts">
import X from '@lucide/svelte/icons/x';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { OwnVessel } from '$entities/vessel';
import { RAD_TO_DEG } from '$shared/lib';
import type { Theme } from '$shared/ui';
import AisRadarSeascape from './AisRadarSeascape.svelte';
import AisRadarTargetPopover from './AisRadarTargetPopover.svelte';
import {
  AIS_RADAR_RANGES_NM,
  type AisRadarRangeNm,
  buildAisRadarContacts,
  createAisRadarContactIndexer,
} from './ais-radar-model';
import type { TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  vessel: OwnVessel;
  targets: AisTargets;
  collision: CollisionAssessment;
  rangeNm: AisRadarRangeNm;
  onRangeChange: (rangeNm: AisRadarRangeNm) => void;
  theme: Theme;
  companionBase?: string | null;
  getToken?: () => string | undefined;
  expanded?: boolean;
  actionLabel: string;
  onOpen: () => void;
}

const {
  label,
  reading,
  vessel,
  targets,
  collision,
  rangeNm,
  onRangeChange,
  theme,
  companionBase,
  getToken,
  expanded = false,
  actionLabel,
  onOpen,
}: Props = $props();

const ownPosition = $derived(vessel.position);
const contacts = $derived.by(() => {
  void targets.version;
  return ownPosition
    ? buildAisRadarContacts({
        ownPosition,
        targets: targets.list(),
        assessment: collision.assessment,
        rangeNm,
      })
    : [];
});
const indexContacts = createAisRadarContactIndexer();
const indexedContacts = $derived(indexContacts(contacts));
let selectedTargetId = $state<string | undefined>();
let detailAnchor = $state<HTMLElement | undefined>();
const selectedContact = $derived(
  selectedTargetId ? indexedContacts.find((contact) => contact.id === selectedTargetId) : undefined,
);
const selectedTarget = $derived.by(() => {
  void targets.version;
  return selectedTargetId ? targets.find(selectedTargetId) : undefined;
});
const ownDirectionDeg = $derived((vessel.headingRad ?? vessel.cogRad ?? 0) * RAD_TO_DEG);
const statusText = $derived(
  reading.state === 'never'
    ? 'Waiting for GPS position'
    : reading.state === 'stale'
      ? 'GPS position is stale'
      : `${contacts.length} ${contacts.length === 1 ? 'target' : 'targets'} in ${rangeNm} nm`,
);
const accessibleLabel = $derived(`${label}, ${statusText}. ${actionLabel}`);

const CENTER = 200;
// Leave only enough room for the outer stroke inside the viewBox. The expanded stage itself is the
// largest square its container can hold, so this radius reaches whichever padded side limits it.
const PLOT_RADIUS = 198;
const HEADING_HALF_ANGLE_RAD = 15 / RAD_TO_DEG;
const headingSectorPath = [
  `M ${CENTER} ${CENTER}`,
  `L ${CENTER - Math.sin(HEADING_HALF_ANGLE_RAD) * PLOT_RADIUS} ${CENTER - Math.cos(HEADING_HALF_ANGLE_RAD) * PLOT_RADIUS}`,
  `A ${PLOT_RADIUS} ${PLOT_RADIUS} 0 0 1 ${CENTER + Math.sin(HEADING_HALF_ANGLE_RAD) * PLOT_RADIUS} ${CENTER - Math.cos(HEADING_HALF_ANGLE_RAD) * PLOT_RADIUS}`,
  'Z',
].join(' ');
const RINGS = [0.25, 0.5, 0.75, 1] as const;
const labelForRing = (fraction: number): string => `${Number((rangeNm * fraction).toFixed(2))} nm`;
const coordinate = (normalized: number): number => CENTER + normalized * PLOT_RADIUS;

function showTargetDetails(id: string, event: MouseEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  selectedTargetId = id;
  detailAnchor = event.currentTarget;
}

function closeTargetDetails(): void {
  const anchor = detailAnchor;
  selectedTargetId = undefined;
  detailAnchor = undefined;
  requestAnimationFrame(() => anchor?.isConnected && anchor.focus({ preventScroll: true }));
}
</script>

{#snippet radarFace()}
  <div class="radar-stage">
    {#if ownPosition}
      <AisRadarSeascape position={ownPosition} {rangeNm} {theme} {companionBase} {getToken} />
    {/if}
    <svg class="radar" viewBox="0 0 400 400" aria-hidden="true">
      <circle class="sector sector--outer" cx={CENTER} cy={CENTER} r={PLOT_RADIUS} />
      <circle class="sector sector--yellow" cx={CENTER} cy={CENTER} r={PLOT_RADIUS * 0.75} />
      <circle class="sector sector--amber" cx={CENTER} cy={CENTER} r={PLOT_RADIUS * 0.5} />
      <circle class="sector sector--red" cx={CENTER} cy={CENTER} r={PLOT_RADIUS * 0.25} />
      <path
        class="heading-sector"
        d={headingSectorPath}
        transform={`rotate(${ownDirectionDeg} ${CENTER} ${CENTER})`}
      />
      <line
        class="bearing-line"
        x1={CENTER}
        y1={CENTER - PLOT_RADIUS}
        x2={CENTER}
        y2={CENTER + PLOT_RADIUS}
      />
      <line
        class="bearing-line"
        x1={CENTER - PLOT_RADIUS}
        y1={CENTER}
        x2={CENTER + PLOT_RADIUS}
        y2={CENTER}
      />
      <g class="north-compass" transform="translate(42 42)">
        <circle r="17" />
        <path d="M 0 -13 L 4 2 L 0 -1 L -4 2 Z" />
        <line x1="0" y1="-1" x2="0" y2="11" />
        <text y="-21" text-anchor="middle">N</text>
      </g>
      {#each RINGS as fraction (fraction)}
        <text class="ring-label" x={CENTER + 5} y={CENTER - PLOT_RADIUS * fraction + 11}>
          {labelForRing(fraction)}
        </text>
      {/each}

      {#each indexedContacts as contact (contact.id)}
        {@const x = coordinate(contact.x)}
        {@const y = coordinate(contact.y)}
        {@const indexX = contact.x > 0.72 ? x - 10 : x + 10}
        <g
          class:danger={contact.severity === 'danger'}
          class:warning={contact.severity === 'warning'}
          class:unassessed={contact.severity === 'unassessed'}
        >
          <title>{contact.name}, {contact.sogText}, {contact.cpaText}</title>
          {#if contact.vectorX !== 0 || contact.vectorY !== 0}
            <line
              class="motion-vector"
              x1={x}
              y1={y}
              x2={coordinate(contact.x + contact.vectorX)}
              y2={coordinate(contact.y + contact.vectorY)}
            />
          {/if}
          <path
            class="target"
            d="M 0 -8 L 5.5 7 L 0 4.5 L -5.5 7 Z"
            transform={`translate(${x} ${y}) rotate(${contact.directionDeg})`}
          />
          {#if contact.severity === 'unassessed'}
            <text class="quality-mark" {x} y={y - 10} text-anchor="middle">?</text>
          {/if}
          <text class="target-index" x={indexX} y={y + 3} text-anchor="middle">
            {contact.index}
          </text>
        </g>
      {/each}

      <g class="own-ship" transform={`translate(${CENTER} ${CENTER}) rotate(${ownDirectionDeg})`}>
        <path d="M 0 -13 L 7 7 L 5 11 L -5 11 L -7 7 Z" />
        <circle cx="0" cy="0" r="12" />
      </g>
    </svg>
    {#each indexedContacts as contact (contact.id)}
      {@const x = coordinate(contact.x)}
      {@const y = coordinate(contact.y)}
      <button
        type="button"
        class="target-hit"
        class:danger={contact.severity === 'danger'}
        class:warning={contact.severity === 'warning'}
        style={`--target-x: ${x / 4}%; --target-y: ${y / 4}%;`}
        aria-label={`Open details for target ${contact.index}, ${contact.name}`}
        title={`Open details for ${contact.name}`}
        onclick={(event) => showTargetDetails(contact.id, event)}
      ></button>
    {/each}
  </div>
  {#if reading.state !== 'live'}
    <div class="radar-message">{statusText}</div>
  {/if}
  <div class="radar-caption">
    <span>{label}</span>
    <span>{rangeNm} nm · {contacts.length} AIS</span>
  </div>
  {#if selectedTarget && selectedContact && detailAnchor}
    <AisRadarTargetPopover
      target={selectedTarget}
      contact={selectedContact}
      anchor={detailAnchor}
      onClose={closeTargetDetails}
    />
  {/if}
{/snippet}

{#if expanded}
  <!-- A radar face is a temporary close-up: tapping its open water collapses it. Direct radar
       controls stack above this full-face button and retain their own actions. -->
  <section class="tile tile--expanded ais-radar" aria-label={accessibleLabel}>
    <button
      class="radar-collapse"
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={onOpen}
    ></button>
    <button
      class="icon-btn close"
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={onOpen}
    >
      <X size={20} aria-hidden="true" />
    </button>
    <div class="range-control" role="group" aria-label="AIS radar range">
      {#each AIS_RADAR_RANGES_NM as range (range)}
        <button
          type="button"
          class:active={range === rangeNm}
          aria-pressed={range === rangeNm}
          onclick={() => onRangeChange(range)}
        >
          {range}
          nm
        </button>
      {/each}
    </div>
    <div class="face face--expanded">{@render radarFace()}</div>
  </section>
{:else}
  <section class="tile ais-radar">
    <button
      class="tile tile-open"
      type="button"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onclick={onOpen}
    ></button>
    <div class="face">{@render radarFace()}</div>
  </section>
{/if}

<style>
.ais-radar {
  position: relative;
  display: flex;
  min-block-size: 15rem;
  overflow: hidden;
  background: var(--surface-raised);
  color: var(--text);
}
.radar-collapse {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  min-block-size: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.radar-collapse:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.face {
  position: relative;
  display: grid;
  inline-size: 100%;
  min-inline-size: 0;
  place-items: center;
  pointer-events: none;
}
.face :global(button) {
  pointer-events: auto;
}
.face :global(.ais-target-popover) {
  pointer-events: auto;
}
.tile-open {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: block;
  min-block-size: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.tile-open:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.radar-stage {
  position: relative;
  display: grid;
  inline-size: min(100%, 28rem);
  max-block-size: 100%;
  aspect-ratio: 1;
}
.radar {
  position: relative;
  z-index: 1;
  display: block;
  inline-size: 100%;
  block-size: 100%;
  color: var(--accent);
}
.sector {
  stroke: color-mix(in srgb, var(--text-muted) 56%, transparent);
  stroke-width: 1;
}
.sector--outer {
  fill: transparent;
}
.sector--yellow {
  fill: color-mix(in srgb, var(--select) 8%, transparent);
}
.sector--amber {
  fill: color-mix(in srgb, var(--warning) 10%, transparent);
}
.sector--red {
  fill: color-mix(in srgb, var(--alarm) 13%, transparent);
}
.bearing-line {
  stroke: color-mix(in srgb, var(--text-muted) 24%, transparent);
  stroke-width: 0.8;
  stroke-dasharray: 2 5;
}
.heading-sector {
  fill: color-mix(in srgb, var(--accent) 7%, transparent);
  stroke: color-mix(in srgb, var(--accent) 24%, transparent);
  stroke-width: 0.8;
}
.north-compass text,
.ring-label,
.target-index,
.quality-mark {
  font-family: var(--font-mono);
  fill: var(--text-muted);
  paint-order: stroke;
  stroke: var(--surface-raised);
  stroke-linejoin: round;
  stroke-width: 1.5px;
}
.north-compass circle {
  fill: color-mix(in srgb, var(--surface-raised) 86%, transparent);
  stroke: var(--text-muted);
  stroke-width: 1;
}
.north-compass path {
  fill: var(--text);
}
.north-compass line {
  stroke: var(--text);
  stroke-width: 1.4;
}
.north-compass text {
  font-size: 9px;
  font-weight: 800;
  fill: var(--text);
  stroke-width: 2px;
}
.ring-label {
  font-size: 7px;
  fill: var(--text);
  stroke: none;
}
.target-index {
  font-size: 9px;
  font-weight: 800;
  fill: var(--text);
  stroke-width: 3px;
}
.target {
  fill: var(--surface-raised);
  stroke: var(--accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.target-hit {
  position: absolute;
  inset-inline-start: var(--target-x);
  inset-block-start: var(--target-y);
  z-index: 2;
  inline-size: var(--control-size);
  block-size: var(--control-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  transform: translate(-50%, -50%);
  cursor: pointer;
}
.target-hit:hover,
.target-hit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--accent-tint);
}
.target-hit.danger:hover,
.target-hit.danger:focus-visible {
  outline-color: var(--alarm);
  background: var(--alarm-tint);
}
.target-hit.warning:hover,
.target-hit.warning:focus-visible {
  outline-color: var(--warning);
  background: var(--warning-tint);
}
.motion-vector {
  stroke: var(--accent);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}
.danger .target {
  fill: var(--alarm);
  stroke: var(--alarm);
  stroke-width: 3;
}
.danger .motion-vector,
.danger .target-index {
  stroke: var(--surface-raised);
  fill: var(--alarm);
}
.warning .target {
  stroke: var(--warning);
  stroke-width: 2.5;
}
.warning .motion-vector,
.warning .target-index {
  stroke: var(--surface-raised);
  fill: var(--warning);
}
.unassessed .target,
.unassessed .motion-vector {
  stroke: var(--warning);
  stroke-dasharray: 2 2;
}
.quality-mark {
  fill: var(--warning);
  font-size: 8px;
  font-weight: 800;
}
.own-ship path {
  fill: var(--text);
  stroke: var(--surface-raised);
  stroke-width: 1.5;
}
.own-ship circle {
  fill: none;
  stroke: var(--text);
  stroke-width: 1;
}
.radar-caption {
  position: absolute;
  inset-inline: var(--space-2);
  inset-block-end: var(--space-1);
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.radar-caption span:first-child {
  color: var(--text);
  font-weight: 700;
}
.radar-message {
  position: absolute;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.close {
  position: absolute;
  inset-block-start: var(--space-3);
  inset-inline-end: var(--space-3);
  z-index: 2;
}
.range-control {
  position: absolute;
  inset-block-start: var(--space-3);
  inset-inline-start: 50%;
  z-index: 2;
  display: flex;
  max-inline-size: calc(100% - 7rem);
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
  transform: translateX(-50%);
}
.range-control button {
  min-block-size: var(--touch-target);
  padding-inline: var(--space-3);
  border: 0;
  background: transparent;
  color: var(--text-muted);
  white-space: nowrap;
}
.range-control button.active {
  background: var(--accent);
  color: var(--surface);
}
.face--expanded {
  flex: 1 1 auto;
  min-block-size: 0;
  container-type: size;
}
.face--expanded .radar-stage {
  inline-size: min(100cqi, 100cqb);
  block-size: min(100cqi, 100cqb);
  max-inline-size: none;
  max-block-size: none;
}
@media (max-width: 600px) {
  .ais-radar {
    min-block-size: 13rem;
  }
  .range-control {
    inset-inline-start: var(--space-2);
    max-inline-size: calc(100% - 4.5rem);
    transform: none;
  }
  .range-control button {
    padding-inline: var(--space-2);
    font-size: var(--text-xs);
  }
}
</style>

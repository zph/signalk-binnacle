<script lang="ts">
import X from '@lucide/svelte/icons/x';
import { type AisTargetView, aisShipTypeLabel, shortVesselId } from '$entities/ais';
import {
  capitalize,
  formatBearingOr,
  formatKnotsOr,
  formatLatitude,
  formatLongitude,
  formatMetersOrNm,
  formatNm,
  formatTcpaMin,
} from '$shared/lib';
import { AnchoredMenu } from '$shared/ui';
import type { IndexedAisRadarContact } from './ais-radar-model';

interface Props {
  target: AisTargetView;
  contact: IndexedAisRadarContact;
  anchor: HTMLElement;
  onClose: () => void;
}

const { target, contact, anchor, onClose }: Props = $props();
</script>

<AnchoredMenu
  open
  {anchor}
  preferredPlacement="auto"
  anchorAlign="start"
  {onClose}
  backdropLabel="Close AIS target details"
  surfaceClass="popover-card ais-target-popover"
  ariaLabel={`AIS target ${contact.index}, ${contact.name}`}
  role="dialog"
  focusTrap
>
  <header class="target-detail-header">
    <span class="legend-index">{contact.index}</span>
    <strong>{contact.name}</strong>
    <button
      type="button"
      class="icon-btn"
      aria-label={`Close details for ${contact.name}`}
      title={`Close details for ${contact.name}`}
      onclick={onClose}
    >
      <X size={16} aria-hidden="true" />
    </button>
  </header>
  {#if contact.severity === 'danger'}
    <p class="alert-note alert-note--filled" role="alert">
      Collision risk. Review the closest pass below.
    </p>
  {:else if contact.severity === 'warning'}
    <p class="alert-note" role="alert">Getting close. Continue monitoring this target.</p>
  {:else if contact.severity === 'unassessed'}
    <p class="muted-note sev-warning" role="status">
      Collision risk is unassessed because motion data is incomplete.
    </p>
  {/if}
  <dl class="detail-list">
    <div class="item">
      <dt>Identifier</dt>
      <dd>{shortVesselId(target.id)}</dd>
    </div>
    <div class="item">
      <dt>Position</dt>
      <dd>
        {formatLatitude(target.position.latitude)} {formatLongitude(target.position.longitude)}
      </dd>
    </div>
    <div class="item">
      <dt>Distance</dt>
      <dd>{formatMetersOrNm(contact.rangeMeters)}</dd>
    </div>
    <div class="item">
      <dt>Bearing</dt>
      <dd>{formatBearingOr(contact.bearingRad)}&deg;T</dd>
    </div>
    <div class="item">
      <dt>Speed over ground</dt>
      <dd>{formatKnotsOr(target.sogMps)} kn</dd>
    </div>
    {#if target.cogRad !== undefined}
      <div class="item">
        <dt>Course</dt>
        <dd>{formatBearingOr(target.cogRad)}&deg;T</dd>
      </div>
    {/if}
    {#if target.headingRad !== undefined}
      <div class="item">
        <dt>Heading</dt>
        <dd>{formatBearingOr(target.headingRad)}&deg;T</dd>
      </div>
    {/if}
    {#if target.navigationState}
      <div class="item">
        <dt>Navigation state</dt>
        <dd>{capitalize(target.navigationState)}</dd>
      </div>
    {/if}
    {#if target.shipTypeId !== undefined}
      <div class="item">
        <dt>Vessel type</dt>
        <dd>{aisShipTypeLabel(target.shipTypeId)}</dd>
      </div>
    {/if}
    {#if contact.cpaMeters !== undefined}
      <div class="item">
        <dt>Closest pass (CPA)</dt>
        <dd>{formatNm(contact.cpaMeters)} nm</dd>
      </div>
    {/if}
    {#if contact.tcpaSeconds !== undefined}
      <div class="item">
        <dt>Time to closest (TCPA)</dt>
        <dd>{formatTcpaMin(contact.tcpaSeconds, 1)} min</dd>
      </div>
    {/if}
  </dl>
</AnchoredMenu>

<style>
:global(.ais-target-popover) {
  z-index: calc(var(--z-menu) + 1);
  display: grid;
  gap: var(--space-2);
  inline-size: min(22rem, calc(100vw - var(--space-4)));
  max-block-size: min(calc(70 * var(--dvh)), 32rem);
  overflow-y: auto;
  padding: var(--space-3);
  color: var(--text);
  text-align: start;
}
.target-detail-header {
  display: grid;
  grid-template-columns: 1.8rem minmax(0, 1fr) var(--control-size);
  gap: var(--space-2);
  align-items: center;
}
.target-detail-header strong {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-index {
  display: grid;
  block-size: 1.8rem;
  border: 1px solid currentColor;
  border-radius: var(--radius-pill);
  place-items: center;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 800;
}
.alert-note,
.muted-note {
  margin: 0;
}
.detail-list {
  font-size: var(--text-sm);
}
.detail-list .item {
  align-items: start;
}
.detail-list dd {
  max-inline-size: 12rem;
}
</style>

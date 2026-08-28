<script lang="ts">
import { DEG_TO_RAD, RAD_TO_DEG } from '$shared/lib';
import { MAX_WIND_ROSE_NO_GO_ANGLE_RAD, MIN_WIND_ROSE_NO_GO_ANGLE_RAD } from '$shared/settings';
import { SubViewHeader } from '$shared/ui';

interface Props {
  noGoAngleRad: number;
  onChange: (angleRad: number) => void;
  onBack: () => void;
}

const { noGoAngleRad, onChange, onBack }: Props = $props();
const angleDeg = $derived(Math.round(noGoAngleRad * RAD_TO_DEG));
const minDeg = Math.round(MIN_WIND_ROSE_NO_GO_ANGLE_RAD * RAD_TO_DEG);
const maxDeg = Math.round(MAX_WIND_ROSE_NO_GO_ANGLE_RAD * RAD_TO_DEG);
</script>

<div class="wind-rose-settings">
  <SubViewHeader title="Wind rose settings" backLabel="Back to instruments" {onBack} />

  <p class="muted-note">
    Set the total no-go sector centered on the wind. The shaded cone and the inner ends of the port
    and starboard arcs move together.
  </p>

  <section class="panel-section" aria-label="No-go sector">
    <h3 class="caps-label">No-go sector</h3>
    <div class="angle-label">
      <label for="wind-rose-no-go-angle">Total angle</label>
      <span class="num">{angleDeg}°</span>
    </div>
    <input
      id="wind-rose-no-go-angle"
      class="range"
      type="range"
      min={minDeg}
      max={maxDeg}
      step="2"
      value={angleDeg}
      aria-valuetext={`${angleDeg} degrees total, ${angleDeg / 2} degrees on each side`}
      oninput={(event) => onChange(Number(event.currentTarget.value) * DEG_TO_RAD)}
    >
    <div class="range-ends" aria-hidden="true">
      <span>Narrow</span>
      <span>Wide</span>
    </div>
    <p class="muted-note muted-note--xs">
      {angleDeg / 2}° to port and {angleDeg / 2}° to starboard of the wind direction.
    </p>
  </section>
</div>

<style>
.wind-rose-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-block-size: 0;
  padding: var(--space-3);
  overflow-y: auto;
}
.panel-section {
  display: grid;
  gap: var(--space-3);
}
.angle-label,
.range-ends {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
.angle-label label {
  font-weight: 700;
}
.range-ends {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}
</style>

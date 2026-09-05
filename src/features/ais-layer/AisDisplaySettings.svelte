<script lang="ts">
import type { AisNameMode, AisVesselKindMode } from './ais-overlay';

interface Props {
  mode: AisVesselKindMode;
  onModeChange: (mode: AisVesselKindMode) => void;
  nameMode: AisNameMode;
  onNameModeChange: (mode: AisNameMode) => void;
  retentionMinutes: number;
  onRetentionMinutesChange: (minutes: number) => void;
}

const {
  mode,
  onModeChange,
  nameMode,
  onNameModeChange,
  retentionMinutes,
  onRetentionMinutesChange,
}: Props = $props();

const RETENTION_OPTIONS = [15, 30, 60, 120, 360, 720, 1440] as const;
</script>

<p class="muted-note">
  Automatic Identification System (AIS) targets can use distinct vessel silhouettes or one simple
  ship symbol. Both remain scaled by the vessel length reported over Signal K.
</p>

<section class="panel-section" aria-label="AIS vessel symbols">
  <h3 class="caps-label">Vessel symbols</h3>
  <div class="segmented" role="group" aria-label="AIS vessel symbol style">
    <button
      type="button"
      class="btn"
      class:is-on={mode === 'type-specific'}
      aria-pressed={mode === 'type-specific'}
      onclick={() => onModeChange('type-specific')}
    >
      Vessel types
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={mode === 'generic'}
      aria-pressed={mode === 'generic'}
      onclick={() => onModeChange('generic')}
    >
      Generic ship
    </button>
  </div>
  <p class="muted-note">
    Vessel types distinguish cargo ships, tankers, passenger vessels, fishing boats, tugs, service
    vessels, motorboats, and sailboats when the target reports its type.
  </p>
</section>

<section class="panel-section" aria-label="AIS vessel names">
  <h3 class="caps-label">Vessel names</h3>
  <div class="segmented" role="group" aria-label="AIS vessel name labels">
    <button
      type="button"
      class="btn"
      class:is-on={nameMode === 'off'}
      aria-pressed={nameMode === 'off'}
      onclick={() => onNameModeChange('off')}
    >
      Off
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={nameMode === 'adaptive'}
      aria-pressed={nameMode === 'adaptive'}
      onclick={() => onNameModeChange('adaptive')}
    >
      Adaptive
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={nameMode === 'on'}
      aria-pressed={nameMode === 'on'}
      onclick={() => onNameModeChange('on')}
    >
      On
    </button>
  </div>
  <p class="muted-note">
    Adaptive shows names at a chart scale of 0.2 nm or closer, hides them when zoomed out, and
    suppresses them in crowded screen areas. On shows every available name, even when labels
    overlap.
  </p>
</section>

<section class="panel-section" aria-label="AIS target retention">
  <h3 class="caps-label">Stale targets</h3>
  <label>
    Keep last known position
    <select
      class="input"
      value={retentionMinutes}
      onchange={(event) => onRetentionMinutesChange(Number(event.currentTarget.value))}
    >
      {#each RETENTION_OPTIONS as minutes (minutes)}
        <option value={minutes}>
          {minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}
        </option>
      {/each}
    </select>
  </label>
  <p class="muted-note">
    Motion is considered stale after 5 minutes. The last known vessel position then turns gray and
    fades until this retention limit. Stale motion is not used as current collision data.
  </p>
</section>

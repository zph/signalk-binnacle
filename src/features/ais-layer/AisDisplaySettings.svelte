<script lang="ts">
import type { AisVesselKindMode } from './ais-overlay';

interface Props {
  mode: AisVesselKindMode;
  onModeChange: (mode: AisVesselKindMode) => void;
}

const { mode, onModeChange }: Props = $props();
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

<script lang="ts">
import { SlideOver } from '$shared/ui';
import DisplaySettings from './DisplaySettings.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, onClose, onBack }: Props = $props();
</script>

<SlideOver title="Display" closeLabel="Close display panel" {onClose} {onBack} bodyFlex>
  <p class="muted-note">
    Let the chart follow daylight automatically, and strengthen it for a bright helm display.
  </p>
  <DisplaySettings {controller} />
</SlideOver>

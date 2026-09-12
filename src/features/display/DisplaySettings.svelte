<script lang="ts">
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
}

const { controller }: Props = $props();
</script>

<section class="panel-section" aria-label="Automatic theme">
  <h3 class="caps-label">Automatic theme</h3>
  <div class="segmented" role="group" aria-label="Automatic theme">
    <button
      type="button"
      class="btn"
      class:is-on={!controller.autoTheme}
      aria-pressed={!controller.autoTheme}
      onclick={() => controller.setAutoTheme(false)}
    >
      Off
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={controller.autoTheme}
      aria-pressed={controller.autoTheme}
      onclick={() => controller.setAutoTheme(true)}
    >
      On
    </button>
  </div>
  <p class="muted-note muted-note--xs">
    Switches between day and night-red from Signal K's day or night mode, or from local sun position
    when Signal K does not supply one. A manual theme choice pauses automatic switching until the
    next day-night change.
  </p>
  {#if controller.autoThemeSuspended}
    <p class="muted-note" role="status">
      Paused for your theme choice. Automatic switching resumes at the next day-night change.
    </p>
  {/if}
</section>

<section class="panel-section" aria-label="Bright sun chart">
  <h3 class="caps-label">Bright sun chart</h3>
  <div class="segmented" role="group" aria-label="Bright sun chart">
    <button
      type="button"
      class="btn"
      class:is-on={!controller.sunMode}
      aria-pressed={!controller.sunMode}
      onclick={() => controller.setSunMode(false)}
    >
      Off
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={controller.sunMode}
      aria-pressed={controller.sunMode}
      onclick={() => controller.setSunMode(true)}
    >
      On
    </button>
  </div>
  <p class="muted-note muted-note--xs">
    Strengthens chart contrast for direct sunlight. It applies only to the day theme; dusk and
    night-red stay unchanged.
  </p>
</section>

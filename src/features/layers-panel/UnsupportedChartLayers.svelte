<script lang="ts">
const { layers = [] }: { layers?: readonly string[] } = $props();
</script>

{#if layers.length > 0}
  <details class="muted-note">
    <summary>Present in chart, not yet rendered ({layers.length})</summary>
    <p>Listed by the chart source; not drawn by Binnacle.</p>
    <ul>
      {#each layers as layer (layer)}
        <li>{layer}</li>
      {/each}
    </ul>
  </details>
{/if}

<style>
summary {
  min-block-size: var(--control-size);
  align-content: center;
  cursor: pointer;
}
li {
  overflow-wrap: anywhere;
}
</style>

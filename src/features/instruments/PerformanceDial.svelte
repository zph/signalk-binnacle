<script lang="ts">
import { clamp } from '$shared/lib';

const { ratio }: { ratio: number | undefined } = $props();
const rotation = $derived(ratio === undefined ? undefined : -90 + clamp(ratio / 1.5, 0, 1) * 180);
</script>

<svg class="performance-dial" viewBox="0 0 200 120" aria-hidden="true">
  <path class="track" d="M 20 100 A 80 80 0 0 1 180 100" />
  {#each [0, 50, 100, 150] as percent (percent)}
    {@const angle = (-90 + percent / 150 * 180) * Math.PI / 180}
    <line
      class:target={percent === 100}
      x1={100 + 70 * Math.sin(angle)}
      y1={100 - 70 * Math.cos(angle)}
      x2={100 + 80 * Math.sin(angle)}
      y2={100 - 80 * Math.cos(angle)}
    />
    <text x={100 + 96 * Math.sin(angle)} y={100 - 96 * Math.cos(angle) + 4}>{percent}</text>
  {/each}
  {#if rotation !== undefined}
    <line
      class="needle"
      x1="100"
      y1="100"
      x2="100"
      y2="34"
      transform="rotate({rotation} 100 100)"
    />
    <circle cx="100" cy="100" r="5" />
  {/if}
</svg>

<style>
.performance-dial {
  inline-size: min(100%, 18rem);
  block-size: auto;
  max-block-size: 45%;
  overflow: visible;
  flex-shrink: 1;
}
.track {
  fill: none;
  stroke: var(--border);
  stroke-width: 8;
}
line {
  stroke: var(--text-muted);
  stroke-width: 2;
}
.target {
  stroke: var(--accent);
  stroke-width: 4;
}
.needle {
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
}
circle {
  fill: var(--accent);
}
text {
  fill: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-anchor: middle;
}
</style>

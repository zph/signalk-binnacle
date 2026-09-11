<script lang="ts">
import { onMount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { LatLon } from '$shared/geo';
import { mapThemePaint } from '$shared/map';
import type { Theme } from '$shared/ui';
import type { AisRadarRangeNm } from './ais-radar-model';
import {
  buildAisRadarShorelinePlan,
  createAisRadarShorelineController,
  createAisRadarShorelineSource,
  drawAisRadarShoreline,
} from './ais-radar-seascape';

interface Props {
  position: LatLon;
  rangeNm: AisRadarRangeNm;
  theme: Theme;
  companionBase?: string | null;
  getToken?: () => string | undefined;
}

const { position, rangeNm, theme, companionBase, getToken }: Props = $props();

let canvas = $state<HTMLCanvasElement>();
let width = $state(0);
let height = $state(0);
let ready = $state(false);
let generation = 0;
const sources = new SvelteMap<string, ReturnType<typeof createAisRadarShorelineSource>>();
let controller: ReturnType<typeof createAisRadarShorelineController> | undefined;

function sourceFor(base: string | null | undefined) {
  const key = base?.replace(/\/+$/, '') ?? 'direct';
  let source = sources.get(key);
  if (!source) {
    source = createAisRadarShorelineSource({ companionBase: base, getToken });
    sources.set(key, source);
  }
  return source;
}

async function render(frame: Parameters<NonNullable<typeof controller>['sync']>[0]): Promise<void> {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const frameWidth = Math.max(1, Math.round(frame.width));
  const frameHeight = Math.max(1, Math.round(frame.height));
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const paint = mapThemePaint(frame.theme);
  context.fillStyle = paint.water;
  context.fillRect(0, 0, frameWidth, frameHeight);
  ready = true;

  const currentGeneration = ++generation;
  const loaded = await sourceFor(frame.companionBase).load((minZoom, maxZoom) =>
    buildAisRadarShorelinePlan(
      frame.position,
      frame.rangeNm,
      frameWidth,
      frameHeight,
      minZoom,
      maxZoom,
    ),
  );
  if (currentGeneration !== generation || !loaded) return;
  drawAisRadarShoreline(
    context,
    { ...frame, width: frameWidth, height: frameHeight },
    loaded.plan,
    loaded.tiles,
  );
}

function sync(): void {
  controller?.sync({ position, rangeNm, width, height, theme, companionBase });
}

onMount(() => {
  controller = createAisRadarShorelineController((frame) => void render(frame));
  sync();
  return () => {
    generation += 1;
    controller?.destroy();
  };
});

$effect(() => {
  sync();
});
</script>

<canvas
  class="seascape"
  class:ready
  bind:this={canvas}
  bind:clientWidth={width}
  bind:clientHeight={height}
  aria-hidden="true"
></canvas>

<style>
.seascape {
  position: absolute;
  inset: 0.5%;
  width: 99%;
  height: 99%;
  overflow: hidden;
  border-radius: 50%;
  background: var(--surface);
  opacity: 0;
  pointer-events: none;
}
.seascape.ready {
  opacity: 1;
}
</style>

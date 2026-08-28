<script lang="ts">
import type { AisTargets } from './ais-targets.svelte';

let { targets }: { targets: AisTargets } = $props();
let names = $derived(
  targets
    .list()
    .map((target) => target.name ?? '')
    .join(','),
);
</script>

<output>{names}</output>

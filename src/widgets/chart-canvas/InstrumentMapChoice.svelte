<script lang="ts">
import type { Snippet } from 'svelte';
import { AnchoredMenu } from '$shared/ui';

interface Choice {
  id: string;
  label: string;
}

interface Props {
  label: string;
  menuLabel: string;
  menuId: string;
  choices: readonly Choice[];
  selectedId: string;
  active: boolean;
  icon: Snippet;
  onSelect: (id: string) => void;
}

const { label, menuLabel, menuId, choices, selectedId, active, icon, onSelect }: Props = $props();
let menuOpen = $state(false);
let trigger = $state<HTMLButtonElement>();

function select(id: string): void {
  onSelect(id);
  menuOpen = false;
}
</script>

<button
  type="button"
  class="icon-btn"
  class:is-on={menuOpen || active}
  aria-label={label}
  aria-haspopup="true"
  aria-expanded={menuOpen}
  aria-controls={menuOpen ? menuId : undefined}
  title={label}
  bind:this={trigger}
  onclick={() => (menuOpen = !menuOpen)}
>
  {@render icon()}
</button>
<AnchoredMenu
  open={menuOpen}
  onClose={() => (menuOpen = false)}
  backdropLabel={`Close ${menuLabel.toLowerCase()} menu`}
  surfaceClass="popover-card menu-surface instrument-map-choice-menu"
  anchor={trigger}
  preferredPlacement="below"
  anchorAlign="end"
  ariaLabel={menuLabel}
  role="radiogroup"
  id={menuId}
  onFocusLeft={() => (menuOpen = false)}
>
  {#each choices as choice (choice.id)}
    <button
      type="button"
      role="radio"
      class="menu-item"
      class:is-on={selectedId === choice.id}
      aria-checked={selectedId === choice.id}
      onclick={() => select(choice.id)}
    >
      {choice.label}
    </button>
  {/each}
</AnchoredMenu>

<style>
:global(.instrument-map-choice-menu) {
  --menu-width: 12rem;
}
:global(.instrument-map-choice-menu .menu-item.is-on) {
  background: var(--accent-tint);
  color: var(--accent);
}
</style>

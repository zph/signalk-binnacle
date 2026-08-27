<script lang="ts">
import Pencil from '@lucide/svelte/icons/pencil';

// The edit-mode entry (full recipe: design-system.md, Edit modes). The visible text IS the
// accessible name except for the optional icon-only entry state.
interface Props {
  object: string;
  editing: boolean;
  onToggle: () => void;
  // A panel header already names the object, so its constrained chrome may show the shorter
  // "Customize" label while preserving the full accessible name.
  compact?: boolean;
  // Constrained headers may use a conventional edit glyph until edit mode is active.
  iconOnly?: boolean;
}

const { object, editing, onToggle, compact = false, iconOnly = false }: Props = $props();
const fullLabel = $derived(editing ? 'Done' : `Customize ${object}`);
const visibleLabel = $derived(!editing && compact ? 'Customize' : fullLabel);
const showIcon = $derived(iconOnly && !editing);
</script>

<button
  type="button"
  class:icon-btn={showIcon}
  class:btn={!showIcon}
  class:btn-ghost={!showIcon}
  aria-label={compact || showIcon ? fullLabel : undefined}
  title={showIcon ? fullLabel : undefined}
  onclick={onToggle}
>
  {#if showIcon}
    <Pencil size={18} aria-hidden="true" />
  {:else}
    {visibleLabel}
  {/if}
</button>

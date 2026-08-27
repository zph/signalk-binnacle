<script lang="ts">
import ArrowLeft from '@lucide/svelte/icons/arrow-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Command from '@lucide/svelte/icons/command';
import Search from '@lucide/svelte/icons/search';
import { onDestroy, tick } from 'svelte';
import { dialog, registerDismiss, SearchInput } from '$shared/ui';
import { type CommandPaletteCommand, filterPaletteCommands } from './command-palette';

interface Props {
  commands: CommandPaletteCommand[];
  onClose: () => void;
}

const { commands, onClose }: Props = $props();

let parent = $state<CommandPaletteCommand>();
let query = $state('');
let selectedIndex = $state(0);
let searchResults = $state.raw<CommandPaletteCommand[]>([]);
let searching = $state(false);
let requestError = $state(false);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | undefined;

const baseCommands = $derived(parent?.children ?? commands);
const visibleCommands = $derived(
  parent?.followUp ? searchResults : filterPaletteCommands(baseCommands, query),
);
const minimumQueryLength = $derived(parent?.followUp?.minimumQueryLength ?? 2);
const placeholder = $derived(
  parent?.followUp?.placeholder ?? (parent ? `Search ${parent.label}` : 'Type a command'),
);

$effect(() => {
  query;
  parent;
  selectedIndex = 0;
});

$effect(() => {
  const followUp = parent?.followUp;
  const cleanQuery = query.trim();
  searchAbort?.abort();
  if (searchTimer) clearTimeout(searchTimer);
  searchResults = [];
  requestError = false;
  searching = false;
  if (!followUp || cleanQuery.length < (followUp.minimumQueryLength ?? 2)) return;

  const abort = new AbortController();
  searchAbort = abort;
  searching = true;
  searchTimer = setTimeout(() => {
    void followUp
      .search(cleanQuery, abort.signal)
      .then((results) => {
        if (abort.signal.aborted) return;
        searchResults = results;
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        requestError = true;
        if (!(error instanceof DOMException && error.name === 'AbortError')) searchResults = [];
      })
      .finally(() => {
        if (!abort.signal.aborted) searching = false;
      });
  }, 300);
});

$effect(() => {
  if (!parent) return;
  return registerDismiss(goBack);
});

onDestroy(() => {
  searchAbort?.abort();
  if (searchTimer) clearTimeout(searchTimer);
});

function goBack(): void {
  searchAbort?.abort();
  parent = undefined;
  query = '';
  searchResults = [];
  requestError = false;
}

function choose(command: CommandPaletteCommand): void {
  if (command.disabled) return;
  if (command.children || command.followUp) {
    parent = command;
    query = '';
    return;
  }
  const action = command.onSelect;
  onClose();
  void tick().then(() => action?.());
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (visibleCommands.length === 0) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    selectedIndex = (selectedIndex + delta + visibleCommands.length) % visibleCommands.length;
    document
      .getElementById(`palette-option-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Enter') {
    const selected = visibleCommands[selectedIndex];
    if (!selected) return;
    event.preventDefault();
    choose(selected);
    return;
  }
  if (event.key === 'Backspace' && query === '' && parent) {
    event.preventDefault();
    goBack();
  }
}
</script>

<dialog class="modal-card command-palette" aria-label="Command palette" use:dialog={onClose}>
  <header class="palette-header">
    {#if parent}
      <button type="button" class="icon-btn" aria-label="Back to all commands" onclick={goBack}>
        <ArrowLeft size={19} aria-hidden="true" />
      </button>
    {:else}
      <Search size={20} aria-hidden="true" />
    {/if}
    <div class="palette-search">
      <SearchInput
        bind:value={query}
        {placeholder}
        ariaLabel={parent ? `Search ${parent.label} commands` : 'Search commands'}
        clearLabel="Clear command search"
        focusOnOpen={true}
        onKeydown={onSearchKeydown}
      />
    </div>
    <kbd aria-label="Escape">esc</kbd>
  </header>

  {#if parent}
    <div class="palette-breadcrumb caps-label">
      <Command size={14} aria-hidden="true" />
      <span>{parent.label}</span>
    </div>
  {/if}

  <div id="command-palette-results" class="palette-results" role="listbox" aria-label="Commands">
    <span class="visually-hidden" role="status">{visibleCommands[selectedIndex]?.label ?? ''}</span>
    {#each visibleCommands as command, index (command.id)}
      <button
        id={`palette-option-${index}`}
        type="button"
        class="palette-command"
        class:is-selected={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        disabled={command.disabled}
        title={command.disabled ? command.disabledReason : undefined}
        onpointermove={() => (selectedIndex = index)}
        onclick={() => choose(command)}
      >
        <span class="palette-command-icon">
          {#if command.icon}
            <command.icon size={19} aria-hidden="true" />
          {:else}
            <Command size={18} aria-hidden="true" />
          {/if}
        </span>
        <span class="palette-command-copy">
          <strong>{command.label}</strong>
          {#if command.disabled && command.disabledReason}
            <small>{command.disabledReason}</small>
          {:else if command.description}
            <small>{command.description}</small>
          {/if}
        </span>
        {#if command.group && !parent}
          <span class="palette-group">{command.group}</span>
        {/if}
        {#if command.children || command.followUp}
          <ChevronRight size={18} aria-hidden="true" />
        {/if}
      </button>
    {:else}
      {#if parent?.followUp && query.trim().length < minimumQueryLength}
        <p class="palette-empty muted-note">Type at least {minimumQueryLength} characters.</p>
      {:else if searching}
        <p class="palette-empty muted-note" role="status">Searching places…</p>
      {:else if requestError}
        <p class="palette-empty alert-note" role="alert">Place search is unavailable right now.</p>
      {:else}
        <p class="palette-empty muted-note">No matching commands.</p>
      {/if}
    {/each}
  </div>

  <footer class="palette-footer">
    <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
    <span><kbd>↵</kbd> open</span>
    {#if parent?.followUp}
      <span class="palette-attribution">
        Online results from
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon</a>
        and
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
          >OpenStreetMap</a
        >
      </span>
    {/if}
  </footer>
</dialog>

<style>
.command-palette {
  inset-block-start: max(var(--space-6), 12dvh);
  inset-block-end: auto;
  inline-size: min(42rem, calc(100dvw - 2 * var(--space-4)));
  max-block-size: min(42rem, calc(100dvh - 2 * var(--space-6)));
  padding: 0;
  overflow: hidden;
}
.palette-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
  padding: var(--space-2) var(--space-3);
  border-block-end: 1px solid var(--border);
}
.palette-search {
  flex: 1;
  min-inline-size: 0;
}
.palette-search :global(.input) {
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: var(--text-lg);
}
kbd {
  min-inline-size: 1.75rem;
  padding: 0.125rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: center;
}
.palette-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4) 0;
  color: var(--accent);
}
.palette-results {
  max-block-size: min(29rem, 58dvh);
  padding: var(--space-2);
  overflow-y: auto;
}
.palette-command {
  display: grid;
  grid-template-columns: var(--control-size) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--control-size);
  padding: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text);
  text-align: start;
}
.palette-command:hover,
.palette-command.is-selected {
  border-color: var(--accent);
  background: var(--accent-tint);
}
.palette-command:disabled {
  opacity: 0.55;
}
.palette-command-icon {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.palette-command-copy {
  display: grid;
  min-inline-size: 0;
}
.palette-command-copy strong,
.palette-command-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-command-copy small,
.palette-group {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.palette-empty {
  margin: var(--space-5) var(--space-3);
  text-align: center;
}
.palette-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  min-block-size: var(--control-size);
  padding: var(--space-2) var(--space-4);
  border-block-start: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.palette-footer span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.palette-attribution {
  margin-inline-start: auto;
}
.palette-attribution a {
  color: var(--accent);
}
@media (max-width: 600px) {
  .command-palette {
    inset-block-start: var(--space-3);
    max-block-size: calc(100dvh - 2 * var(--space-3));
  }
  .palette-group,
  .palette-footer > span:not(.palette-attribution) {
    display: none;
  }
  .palette-attribution {
    margin-inline-start: 0;
  }
}
</style>

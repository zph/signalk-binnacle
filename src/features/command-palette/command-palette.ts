import type { LucideIcon } from '@lucide/svelte';

export interface CommandPaletteSearch {
  placeholder: string;
  minimumQueryLength?: number;
  search: (query: string, signal: AbortSignal) => Promise<CommandPaletteCommand[]>;
}

export interface CommandPaletteCommand {
  id: string;
  label: string;
  description?: string;
  group?: string;
  keywords?: string[];
  icon?: LucideIcon;
  disabled?: boolean;
  disabledReason?: string;
  children?: CommandPaletteCommand[];
  followUp?: CommandPaletteSearch;
  onSelect?: () => void;
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

function score(command: CommandPaletteCommand, query: string): number | undefined {
  const label = normalized(command.label);
  const terms = [label, command.group, command.description, ...(command.keywords ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map(normalized);
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.every((word) => terms.some((term) => term.includes(word)))) return undefined;
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  return 3;
}

export function filterPaletteCommands(
  commands: CommandPaletteCommand[],
  query: string,
): CommandPaletteCommand[] {
  const cleanQuery = normalized(query);
  if (!cleanQuery) return commands;
  return commands
    .map((command, index) => ({ command, index, score: score(command, cleanQuery) }))
    .filter(
      (entry): entry is { command: CommandPaletteCommand; index: number; score: number } =>
        entry.score !== undefined,
    )
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}

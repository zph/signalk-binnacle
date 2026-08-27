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

// A single unmodified number key must resolve without waiting to see whether another digit follows.
// Nine actionable rows keep every selectable command reachable through one stable 1 through 9
// shortcut; disabled explanations may remain between them, and the rest stay available through search.
export const MAX_PALETTE_RESULTS = 9;

export function limitPaletteCommands(commands: CommandPaletteCommand[]): CommandPaletteCommand[] {
  const displayed: CommandPaletteCommand[] = [];
  let enabledCount = 0;
  for (const command of commands) {
    if (!command.disabled && enabledCount >= MAX_PALETTE_RESULTS) break;
    displayed.push(command);
    if (!command.disabled) {
      enabledCount += 1;
      if (enabledCount >= MAX_PALETTE_RESULTS) break;
    }
  }
  return displayed;
}

export function nextEnabledPaletteIndex(
  commands: CommandPaletteCommand[],
  currentIndex: number,
  delta: 1 | -1,
): number {
  if (commands.length === 0) return 0;
  for (let step = 1; step <= commands.length; step += 1) {
    const index = (currentIndex + delta * step + commands.length) % commands.length;
    if (!commands[index]?.disabled) return index;
  }
  return currentIndex;
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

import { describe, expect, it } from 'vitest';
import {
  type CommandPaletteCommand,
  filterPaletteCommands,
  limitPaletteCommands,
  nextEnabledPaletteIndex,
} from './command-palette';

const commands: CommandPaletteCommand[] = [
  { id: 'layers', label: 'Layers and charts', group: 'Chart', keywords: ['overlays'] },
  { id: 'instruments', label: 'Instruments', group: 'Display', keywords: ['dock gauges'] },
  { id: 'goto', label: 'Go to', group: 'Navigate', keywords: ['place destination'] },
];

describe('filterPaletteCommands', () => {
  it('matches labels, groups, and keywords without accents or case', () => {
    expect(filterPaletteCommands(commands, 'GAUGES').map((item) => item.id)).toEqual([
      'instruments',
    ]);
    expect(filterPaletteCommands(commands, 'chart layers').map((item) => item.id)).toEqual([
      'layers',
    ]);
  });

  it('puts an exact label match ahead of broader keyword matches', () => {
    const input = [
      { id: 'one', label: 'Place details', keywords: ['go to'] },
      { id: 'two', label: 'Go to', keywords: ['place'] },
    ];
    expect(filterPaletteCommands(input, 'go to').map((item) => item.id)).toEqual(['two', 'one']);
  });
});

describe('palette shortcuts', () => {
  it('limits displayed commands to the nine single-key shortcuts', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      label: `Command ${index + 1}`,
    }));
    expect(limitPaletteCommands(many).map((command) => command.id)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  it('keeps disabled explanations without consuming shortcut slots', () => {
    const many = [
      { id: 'disabled', label: 'Unavailable', disabled: true },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: String(index),
        label: `Command ${index + 1}`,
      })),
    ];
    const displayed = limitPaletteCommands(many);
    expect(displayed[0]?.id).toBe('disabled');
    expect(displayed.filter((command) => !command.disabled)).toHaveLength(9);
    expect(displayed.at(-1)?.id).toBe('8');
  });

  it('moves in either direction while skipping disabled commands', () => {
    const input = [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two', disabled: true },
      { id: 'three', label: 'Three' },
    ];
    expect(nextEnabledPaletteIndex(input, 0, 1)).toBe(2);
    expect(nextEnabledPaletteIndex(input, 2, 1)).toBe(0);
    expect(nextEnabledPaletteIndex(input, 0, -1)).toBe(2);
  });
});

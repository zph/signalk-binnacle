import { describe, expect, it } from 'vitest';
import { type CommandPaletteCommand, filterPaletteCommands } from './command-palette';

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

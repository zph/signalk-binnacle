import type { TileCategory } from './tile-catalog';

// An instrument-catalog control for a visual that already lives elsewhere. Aliases participate in
// Customize's shown/available workflow, but never create a dock tile or a second persisted setting;
// their owner supplies the one visibility value and toggle action.
export interface InstrumentAlias {
  type: 'alias';
  id: string;
  label: string;
  description: string;
  category: TileCategory;
  visible: boolean;
  onToggle(visible: boolean): void;
}

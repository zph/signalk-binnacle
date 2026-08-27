import type { Bbox4 } from '$shared/geo';

type MapSourceType = 'tilelayer' | 'WMS' | 'WMTS' | 'tileJSON' | 'mapstyleJSON' | 'S-57';

export interface ChartScaleControl {
  queryParameter: string;
  minimum: number;
  maximum: number;
  step: number;
  default: number;
}

export type ChartCellSizeControl = ChartScaleControl;

export interface SignalKChart {
  identifier: string;
  name: string;
  description?: string;
  type: MapSourceType;
  scale?: number;
  bounds?: Bbox4;
  minzoom?: number;
  maxzoom?: number;
  format?: string;
  url?: string;
  tilemapUrl?: string;
  layers?: string[];
  defaultVisible?: boolean;
  featureInfo?: 'bathymetry-cell';
  cellSizeControl?: ChartCellSizeControl;
}

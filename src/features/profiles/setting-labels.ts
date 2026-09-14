import type { PortableProfileSettingKey } from '$entities/profile';

// The navigator-facing name of every portable setting a profile carries, so a prompt can say what a
// change would touch. The Record type makes a new portable key a build error here rather than an
// unnamed entry in the list.
const PROFILE_SETTING_LABELS: Record<PortableProfileSettingKey, string> = {
  theme: 'Theme',
  layers: 'Charts and overlays',
  layerOrder: 'Layer order',
  weatherLayers: 'Weather layers',
  weatherSource: 'Weather source',
  aisIconMode: 'AIS symbols',
  aisNameMode: 'AIS vessel names',
  aisRetentionMinutes: 'AIS target retention',
  thresholds: 'Collision thresholds',
  trackSettings: 'Track recording',
  planningSpeedMps: 'Estimated average speed',
  units: 'Units',
  chartOrientation: 'Chart orientation',
  pinnedActionIds: 'Toolbar actions',
  instrumentTiles: 'Instrument dock',
  instrumentTileLayouts: 'Instrument tile layout',
  instrumentLayouts: 'Instrument layouts',
  instrumentScreenLayout: 'Floating chart instruments',
  instrumentOverlayOpacity: 'Floating instrument opacity',
  windRoseNoGoAngleRad: 'Wind rose no-go angle',
  windRoseArcMarginRad: 'Wind rose fallback arc margin',
  trendInstrumentIds: 'Data trends',
  anchorRadiusMeters: 'Anchor radius',
  displayAutoTheme: 'Automatic theme',
  displaySunMode: 'Bright sun chart',
};

const LIST_FORMAT = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });

/** The changed settings as a sentence fragment ("Theme, Charts and overlays, and Anchor radius"), or
 * undefined when nothing portable differs. */
export function profileChangeSummary(
  keys: readonly PortableProfileSettingKey[],
): string | undefined {
  if (keys.length === 0) return undefined;
  return LIST_FORMAT.format(keys.map((key) => PROFILE_SETTING_LABELS[key]));
}

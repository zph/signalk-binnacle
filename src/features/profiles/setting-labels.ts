import type { PortableProfileSettingKey } from '$entities/profile';

// The navigator-facing name of every portable setting a profile carries, so a prompt can say what a
// change would touch. The Record type makes a new portable key a build error here rather than an
// unnamed entry in the list.
const PROFILE_SETTING_LABELS: Record<PortableProfileSettingKey, string> = {
  theme: 'Theme',
  layers: 'Charts and overlays',
  layerOrder: 'Layer order',
  weatherLayers: 'Weather layers',
  aisIconMode: 'AIS symbols',
  thresholds: 'Collision thresholds',
  trackSettings: 'Track recording',
  planningSpeedMps: 'Planning speed',
  units: 'Units',
  chartOrientation: 'Chart orientation',
  pinnedActionIds: 'Toolbar actions',
  instrumentTiles: 'Instrument dock',
  trendInstrumentIds: 'Data trends',
  anchorRadiusMeters: 'Anchor radius',
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

export type PersistenceScope =
  | 'profile'
  | 'device'
  | 'server-resource'
  | 'safety'
  | 'credential'
  | 'cache'
  | 'draft';

interface StorageKeyDefinition {
  key: `binnacle-custom:${string}`;
  scope: PersistenceScope;
}

// The production Binnacle localStorage inventory. Call sites use the typed accessor, privacy erasure
// consumes the classified inventory, and a source-inventory test rejects hardcoded Binnacle keys.
const BINNACLE_STORAGE_KEYS = {
  theme: { key: 'binnacle-custom:theme', scope: 'profile' },
  mapView: { key: 'binnacle-custom:map-view', scope: 'device' },
  instrumentMapView: { key: 'binnacle-custom:instrument-map-view', scope: 'device' },
  instrumentMapRenderingQuality: {
    key: 'binnacle-custom:instrument-map-rendering-quality',
    scope: 'device',
  },
  instrumentMapAisVisibility: {
    key: 'binnacle-custom:instrument-map-ais-visibility',
    scope: 'device',
  },
  trackSettings: { key: 'binnacle-custom:track-settings', scope: 'profile' },
  lookoutThresholds: { key: 'binnacle-custom:lookout-thresholds', scope: 'profile' },
  alarmLocation: { key: 'binnacle-custom:alarm-location', scope: 'server-resource' },
  alarmSilencedUntil: { key: 'binnacle-custom:alarm-silenced-until', scope: 'safety' },
  units: { key: 'binnacle-custom:units', scope: 'profile' },
  arrivalMuted: { key: 'binnacle-custom:arrival-muted', scope: 'safety' },
  planningSpeedMps: { key: 'binnacle-custom:planning-speed-mps', scope: 'profile' },
  // Legacy: the same setting in knots, read once to seed the SI key above and never written again.
  // It stays in the inventory so the privacy erasure still clears it from an upgraded device.
  planningSpeedKn: { key: 'binnacle-custom:planning-speed-kn', scope: 'profile' },
  weatherLayers: { key: 'binnacle-custom:weather-layers', scope: 'profile' },
  weatherSource: { key: 'binnacle-custom:weather-source', scope: 'profile' },
  layers: { key: 'binnacle-custom:layers', scope: 'profile' },
  layerOrder: { key: 'binnacle-custom:layer-order', scope: 'profile' },
  aisIconMode: { key: 'binnacle-custom:ais-icon-mode', scope: 'device' },
  aisRetentionMinutes: { key: 'binnacle-custom:ais-retention-minutes', scope: 'device' },
  aisNames: { key: 'binnacle-custom:ais-names', scope: 'cache' },
  radarAutoEnabled: { key: 'binnacle-custom:radar-autoenabled', scope: 'device' },
  pinnedActions: { key: 'binnacle-custom:pinned-actions', scope: 'profile' },
  bottomToolbarLabels: { key: 'binnacle-custom:bottom-toolbar-labels', scope: 'device' },
  bottomStatusReadouts: { key: 'binnacle-custom:bottom-status-readouts', scope: 'device' },
  actionDialPosition: { key: 'binnacle-custom:action-dial-position', scope: 'device' },
  screenWakeLockEnabled: { key: 'binnacle-custom:screen-wake-lock-enabled', scope: 'device' },
  instrumentTiles: { key: 'binnacle-custom:instrument-tiles', scope: 'profile' },
  instrumentWebviews: { key: 'binnacle-custom:instrument-webviews', scope: 'profile' },
  instrumentTileLayouts: { key: 'binnacle-custom:instrument-tile-layouts', scope: 'profile' },
  windRoseNoGoAngleRad: { key: 'binnacle-custom:wind-rose-no-go-angle-rad', scope: 'profile' },
  windRoseArcMarginRad: { key: 'binnacle-custom:wind-rose-arc-margin-rad', scope: 'profile' },
  trendInstruments: { key: 'binnacle-custom:trend-instruments', scope: 'profile' },
  instrumentsOpen: { key: 'binnacle-custom:instruments-open', scope: 'device' },
  interfaceLocked: { key: 'binnacle-custom:interface-locked', scope: 'device' },
  instrumentDockWidth: { key: 'binnacle-custom:instrument-dock-width', scope: 'device' },
  // Instruments placed freely over the chart in screen edit mode. Device scope like the dock's
  // open state and width: helm chrome and layout, never carried in a profile.
  instrumentScreenLayout: {
    key: 'binnacle-custom:instrument-screen-layout',
    scope: 'device',
  },
  instrumentOverlayOpacity: {
    key: 'binnacle-custom:instrument-overlay-opacity',
    scope: 'device',
  },
  aisRadarRangeNm: { key: 'binnacle-custom:ais-radar-range-nm', scope: 'device' },
  layerCategories: { key: 'binnacle-custom:layer-categories', scope: 'device' },
  mapRenderingQuality: { key: 'binnacle-custom:map-rendering-quality', scope: 'device' },
  userCharts: { key: 'binnacle-custom:user-charts', scope: 'server-resource' },
  anchorWatch: { key: 'binnacle-custom:anchor-watch', scope: 'safety' },
  anchorRadius: { key: 'binnacle-custom:anchor-radius', scope: 'profile' },
  mob: { key: 'binnacle-custom:mob', scope: 'safety' },
  profiles: { key: 'binnacle-custom:profiles', scope: 'profile' },
  profileDevice: { key: 'binnacle-custom:profile-device', scope: 'device' },
  signalkAuth: { key: 'binnacle-custom:signalk-auth', scope: 'credential' },
  chartActionsHint: { key: 'binnacle-custom:chart-actions-hint', scope: 'device' },
  // The first-run orientation was dismissed on this device; Help reopens it on demand.
  helpOrientation: { key: 'binnacle-custom:help-orientation', scope: 'device' },
  // The plain-HTTP warning was dismissed on this device; Help keeps the durable explanation.
  insecureNote: { key: 'binnacle-custom:insecure-note', scope: 'device' },
  // The region-aware chart prompt was answered or dismissed on this device; it never returns.
  encPrompt: { key: 'binnacle-custom:enc-prompt', scope: 'device' },
  // Watch-handoff snapshots taken while the shared server store was unreachable, queued to sync.
  handoffDrafts: { key: 'binnacle-custom:handoff-drafts', scope: 'draft' },
  chartOrientation: { key: 'binnacle-custom:chart-orientation', scope: 'profile' },
} as const satisfies Record<string, StorageKeyDefinition>;

type BinnacleStorageKeyId = keyof typeof BINNACLE_STORAGE_KEYS;

export function binnacleStorageKey(id: BinnacleStorageKeyId): `binnacle-custom:${string}` {
  return BINNACLE_STORAGE_KEYS[id].key;
}

export function binnacleStorageKeysForScope(
  ...scopes: readonly PersistenceScope[]
): Array<`binnacle-custom:${string}`> {
  const wanted = new Set(scopes);
  return Object.values(BINNACLE_STORAGE_KEYS)
    .filter((definition) => wanted.has(definition.scope))
    .map((definition) => definition.key);
}

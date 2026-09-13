import { hasControlCharacters, isRecord } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import type { PersistedCodec } from '$shared/settings';

// The optional per-layer settings an overlay may carry beside visibility and opacity. The codec
// retains them when valid and drops the key otherwise: the layer manager re-coerces a missing
// optional field to its safe default on restore, so a dropped key degrades one control while the
// rest of the entry survives. Keeping an entry always well-formed also lets the migration check
// below compare the state's own key count against what the decode retained, rather than a
// hard-coded total that would have to grow again with the next optional field.
const OPTIONAL_OVERLAY_KEYS = [
  'cellSizeScale',
  'labelSizeScale',
  'displayDepth',
  'cellPortrayal',
] as const;

// The codec is module-agnostic (it serves every overlay and the weather layers), so these bounds
// are coarse guards against corruption rather than any one control's range; each module re-coerces
// a restored scale through its own control on restore.
const MAX_CELL_SIZE_SCALE = 16;
const LABEL_SIZE_SCALE_MIN = 0.5;
const LABEL_SIZE_SCALE_MAX = 2;

export const layerSettingsCodec: PersistedCodec<LayerSettings> = {
  decode(value) {
    if (!isRecord(value)) return { state: 'invalid' };
    const entries = Object.entries(value);
    if (entries.length > 512) return { state: 'invalid' };
    const cleaned = Object.create(null) as LayerSettings;
    let migrated = Object.getPrototypeOf(value) !== Object.prototype;
    for (const [id, state] of entries) {
      if (
        id.length === 0 ||
        id.length > 256 ||
        id === '__proto__' ||
        id === 'prototype' ||
        id === 'constructor' ||
        hasControlCharacters(id) ||
        !isRecord(state) ||
        typeof state.visible !== 'boolean' ||
        typeof state.opacity !== 'number' ||
        !Number.isFinite(state.opacity) ||
        state.opacity < 0 ||
        state.opacity > 1 ||
        (state.cellSizeScale !== undefined &&
          (typeof state.cellSizeScale !== 'number' ||
            !Number.isFinite(state.cellSizeScale) ||
            state.cellSizeScale <= 0 ||
            state.cellSizeScale > MAX_CELL_SIZE_SCALE)) ||
        (state.labelSizeScale !== undefined &&
          (typeof state.labelSizeScale !== 'number' ||
            !Number.isFinite(state.labelSizeScale) ||
            state.labelSizeScale < LABEL_SIZE_SCALE_MIN ||
            state.labelSizeScale > LABEL_SIZE_SCALE_MAX))
      ) {
        return { state: 'invalid' };
      }
      const retained: LayerSettings[string] = {
        visible: state.visible,
        opacity: state.opacity,
        ...(typeof state.cellSizeScale === 'number' ? { cellSizeScale: state.cellSizeScale } : {}),
        ...(typeof state.labelSizeScale === 'number'
          ? { labelSizeScale: state.labelSizeScale }
          : {}),
        ...(state.displayDepth === 'conservative' || state.displayDepth === 'predicted'
          ? { displayDepth: state.displayDepth }
          : {}),
        ...(state.cellPortrayal === 'shaded' || state.cellPortrayal === 'text'
          ? { cellPortrayal: state.cellPortrayal }
          : {}),
      };
      cleaned[id] = retained;
      // A stored entry whose own key set does not match what the decode retained is drifting: an
      // unknown key, an invalid optional value the decode dropped, or a scale carrying its value
      // off its own property (setters on a prototype). Flag it migrated so storage rewrites the
      // canonical shape.
      migrated ||=
        Object.keys(state).length !== Object.keys(retained).length ||
        !Object.hasOwn(state, 'visible') ||
        !Object.hasOwn(state, 'opacity') ||
        OPTIONAL_OVERLAY_KEYS.some((key) => state[key] !== undefined && !Object.hasOwn(state, key));
    }
    const legacyCoverageId = 'chart-signalk-bathymetry-noaa-csb-coverage';
    const csbId = 'chart-signalk-bathymetry-noaa-csb-vector';
    const legacyCoverage = cleaned[legacyCoverageId];
    if (legacyCoverage) {
      const depths = cleaned[csbId];
      cleaned[csbId] = {
        visible: legacyCoverage.visible || (depths?.visible ?? false),
        opacity: 1,
      };
      for (const key of ['coverage', 'tracks']) {
        cleaned[`${csbId}:facet:${key}`] ??= { ...legacyCoverage };
      }
      cleaned[`${csbId}:facet:depths`] ??= depths ?? { visible: false, opacity: 1 };
      delete cleaned[legacyCoverageId];
      migrated = true;
    }
    return { state: migrated ? 'migrated' : 'valid', value: cleaned };
  },
};

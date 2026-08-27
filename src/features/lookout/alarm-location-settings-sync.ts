import type { AlarmLocation, PersistedValue } from '$shared/settings';
import {
  loadAlarmLocationSettings,
  saveAlarmLocationSettings,
} from './alarm-location-settings-client';
import { createServerSettingSync, type ServerSettingSync } from './collision-settings-sync';

interface AlarmLocationSettingsSyncDeps {
  origin: string;
  alarmLocation: PersistedValue<AlarmLocation>;
  getToken: () => string | undefined;
}

export function createAlarmLocationSettingsSync(
  deps: AlarmLocationSettingsSyncDeps,
): ServerSettingSync<AlarmLocation> {
  return createServerSettingSync({
    store: deps.alarmLocation,
    toRemote: (value) => value,
    merge: (_current, value) => value,
    signature: (value) => value,
    load: async () => {
      const result = await loadAlarmLocationSettings(deps.origin, deps.getToken());
      return result.state === 'configured'
        ? { state: 'configured', value: result.location }
        : result;
    },
    save: (value) => saveAlarmLocationSettings(deps.origin, deps.getToken(), value),
    writeError: 'Alarm location write failed',
  });
}

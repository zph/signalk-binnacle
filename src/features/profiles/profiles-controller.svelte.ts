import { tick } from 'svelte';
import type {
  AsyncProfileAdapter,
  PortableProfileSettingKey,
  Profile,
  ProfileSettings,
  ProfileStore,
} from '$entities/profile';
import { DISPLAY_PROFILE_SETTING_KEYS, PORTABLE_PROFILE_SETTING_KEYS } from '$entities/profile';
import { sameJsonValue } from '$shared/lib';
import type { ProfileBindings } from './profile-bindings';
import { seedStarterProfiles } from './starter-profiles';

interface ProfilesControllerDeps {
  store: ProfileStore;
  bindings: ProfileBindings;
  applyRuntime(settings: ProfileSettings): void;
  displaySource?: {
    get(): string | undefined;
    set(id: string | undefined): void;
  };
  autosaveMs?: number;
}

interface PendingAutosave {
  settings: ProfileSettings;
  keys: Set<PortableProfileSettingKey>;
}

function cloneValue<T>(value: T): T {
  return structuredClone($state.snapshot(value)) as T;
}

export function createProfilesController(deps: ProfilesControllerDeps) {
  const autosaveMs = deps.autosaveMs ?? 350;
  let applying = false;
  let initialized = false;
  let initializing: Promise<void> | undefined;
  let syncing: Promise<void> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingAutosaves = new Map<string, PendingAutosave>();
  let lastObserved: ProfileSettings | undefined;
  let applyGeneration = 0;
  let preInitializationChanged = false;
  let suspended = false;
  let provisionalProfileId: string | undefined;
  let provisionalChanged = false;
  let provisionalBaseline:
    | {
        name: string;
        settings: ProfileSettings;
      }
    | undefined;

  function capture(): ProfileSettings {
    return deps.bindings.capture();
  }

  function displaySourceId(): string | undefined {
    const id = deps.displaySource?.get();
    if (!id) return undefined;
    if (deps.store.profileById(id)) return id;
    deps.displaySource?.set(undefined);
    return undefined;
  }

  function targetProfileId(key: PortableProfileSettingKey): string | undefined {
    return (DISPLAY_PROFILE_SETTING_KEYS as readonly PortableProfileSettingKey[]).includes(key)
      ? (displaySourceId() ?? deps.store.activeId)
      : deps.store.activeId;
  }

  function effectiveSettings(
    settings: ProfileSettings,
    operationalProfileId = deps.store.activeId,
  ): ProfileSettings {
    const sourceId = displaySourceId();
    const source =
      sourceId === operationalProfileId ? { settings } : deps.store.profileById(sourceId);
    if (!source) return settings;
    const effective = { ...settings };
    const mutable = effective as unknown as Record<string, unknown>;
    for (const key of DISPLAY_PROFILE_SETTING_KEYS) {
      if (Object.hasOwn(source.settings, key)) mutable[key] = cloneValue(source.settings[key]);
      else delete mutable[key];
    }
    return effective;
  }

  function updateFieldsByOwner(
    settings: ProfileSettings,
    keys: readonly PortableProfileSettingKey[],
  ): void {
    const grouped = new Map<string, PortableProfileSettingKey[]>();
    for (const key of keys) {
      const id = targetProfileId(key);
      if (!id) continue;
      grouped.set(id, [...(grouped.get(id) ?? []), key]);
    }
    for (const [id, ownedKeys] of grouped) deps.store.updateFields(id, settings, ownedKeys);
  }

  function applySettings(settings: ProfileSettings): void {
    const generation = ++applyGeneration;
    applying = true;
    try {
      deps.bindings.apply(settings);
      deps.applyRuntime(settings);
      lastObserved = capture();
    } catch (error) {
      if (generation === applyGeneration) applying = false;
      throw error;
    }
    void tick().then(() => {
      if (generation === applyGeneration) applying = false;
    });
  }

  function flushAutosave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    const pending = [...pendingAutosaves.entries()];
    pendingAutosaves.clear();
    if (!suspended) {
      for (const [id, item] of pending) deps.store.updateFields(id, item.settings, [...item.keys]);
    }
  }

  function scheduleAutosave(
    id: string,
    settings: ProfileSettings,
    keys: PortableProfileSettingKey[],
  ): void {
    const existing = pendingAutosaves.get(id);
    pendingAutosaves.set(id, {
      settings,
      keys: new Set([...(existing?.keys ?? []), ...keys]),
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushAutosave, autosaveMs);
  }

  function observeSettings(): void {
    deps.bindings.track();
    const current = capture();
    if (!initialized) {
      if (
        lastObserved &&
        PORTABLE_PROFILE_SETTING_KEYS.some(
          (key) => !sameJsonValue(lastObserved?.[key], current[key]),
        )
      ) {
        preInitializationChanged = true;
      }
      lastObserved = current;
      return;
    }
    if (applying || suspended) {
      lastObserved = current;
      return;
    }
    if (!deps.store.activeId) return;
    const previous = lastObserved;
    lastObserved = current;
    if (!previous) return;
    const changed = PORTABLE_PROFILE_SETTING_KEYS.filter(
      (key) => !sameJsonValue(previous[key], current[key]),
    );
    if (changed.length > 0) {
      if (deps.store.activeId === provisionalProfileId) provisionalChanged = true;
      const grouped = new Map<string, PortableProfileSettingKey[]>();
      for (const key of changed) {
        const id = targetProfileId(key);
        if (id) grouped.set(id, [...(grouped.get(id) ?? []), key]);
      }
      for (const [id, keys] of grouped) scheduleAutosave(id, current, keys);
      // Collision and shallow-water thresholds are safety settings. A preset click or field commit
      // must reach the active profile before the navigator can leave Alarms or switch context;
      // otherwise the debounce window can let the previous profile value replace the visible edit.
      if (changed.includes('thresholds')) flushAutosave();
    }
  }

  function selectStartupProfile(provisional = false): Profile {
    let profile = deps.store.active;
    if (!profile && deps.store.defaultId) profile = deps.store.profileById(deps.store.defaultId);
    if (profile) return profile;
    if (deps.store.profiles.length === 0) {
      if (preInitializationChanged || provisional) {
        profile = deps.store.save('Current setup', capture());
      } else {
        seedStarterProfiles(deps.store, capture());
        profile = deps.store.profiles[0];
      }
    }
    return profile ?? deps.store.save('Current setup', capture());
  }

  function preserveLocalDrift(): void {
    const active = deps.store.active;
    const applied = deps.store.appliedSettings;
    if (!active || !applied) return;
    const current = capture();
    const expected = effectiveSettings(applied, active.id);
    const changed = PORTABLE_PROFILE_SETTING_KEYS.filter(
      (key) => !sameJsonValue(expected[key], current[key]),
    );
    updateFieldsByOwner(current, changed);
  }

  function migrateLegacyInstrumentDisplay(): void {
    const current = capture();
    const legacyLayout = current.instrumentScreenLayout;
    const legacyOpacity = current.instrumentOverlayOpacity;
    for (const profile of deps.store.profiles) {
      const migrated = { ...profile.settings };
      const keys: PortableProfileSettingKey[] = [];
      if (
        profile.settings.instrumentScreenLayout === undefined &&
        legacyLayout &&
        legacyLayout.length > 0
      ) {
        migrated.instrumentScreenLayout = cloneValue(legacyLayout);
        keys.push('instrumentScreenLayout');
      }
      if (
        profile.settings.instrumentOverlayOpacity === undefined &&
        legacyOpacity !== undefined &&
        legacyOpacity !== 1
      ) {
        migrated.instrumentOverlayOpacity = legacyOpacity;
        keys.push('instrumentOverlayOpacity');
      }
      if (keys.length > 0) deps.store.updateFields(profile.id, migrated, keys);
    }
  }

  async function initialize(server?: AsyncProfileAdapter, provisional = false): Promise<void> {
    if (initialized) {
      if (server) await deps.store.syncWithServer(server);
      return;
    }
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        preserveLocalDrift();
        const syncResult = server ? await deps.store.syncWithServer(server) : undefined;
        if (!server) deps.store.setLocalOnly();
        migrateLegacyInstrumentDisplay();
        const provisionalStartup = provisional || syncResult?.ok === false;
        const profile = selectStartupProfile(provisionalStartup);
        if (
          provisionalStartup &&
          deps.store.profiles.length === 1 &&
          profile.name === 'Current setup'
        ) {
          provisionalProfileId = profile.id;
          provisionalChanged = preInitializationChanged;
          provisionalBaseline = { name: profile.name, settings: capture() };
        }
        if (deps.store.activeId === profile.id && deps.store.remoteUpdateAvailable) {
          // The cached profile is newer than the setup this browser last applied. Keep the live
          // persisted stores in place until the navigator resolves the remote-update prompt.
          lastObserved = capture();
        } else {
          applySettings(effectiveSettings(profile.settings, profile.id));
          deps.store.setActive(profile.id);
        }
        initialized = true;
      } finally {
        initializing = undefined;
      }
    })();
    return initializing;
  }

  function initializeFallback(): Promise<void> {
    return initialize(undefined, true);
  }

  async function sync(server: AsyncProfileAdapter): Promise<void> {
    if (syncing) return syncing;
    if (!initialized) {
      await initialize(server);
      return;
    }
    syncing = (async () => {
      try {
        flushAutosave();
        const activeBefore = deps.store.activeId;
        const provisional = deps.store.profileById(provisionalProfileId);
        const provisionalUntouched =
          provisionalProfileId !== undefined &&
          deps.store.activeId === provisionalProfileId &&
          provisionalBaseline !== undefined &&
          !provisionalChanged &&
          provisional?.name === provisionalBaseline.name &&
          sameJsonValue(provisional.settings, provisionalBaseline.settings);
        const discardProvisional =
          provisionalUntouched && provisionalProfileId ? [provisionalProfileId] : undefined;
        const result = await deps.store.syncWithServer(server, {
          discardUnsyncedProfileIds: discardProvisional,
        });
        if (result.ok && discardProvisional) {
          provisionalProfileId = undefined;
          provisionalChanged = false;
          provisionalBaseline = undefined;
          const profile = selectStartupProfile();
          applySettings(effectiveSettings(profile.settings, profile.id));
          deps.store.setActive(profile.id);
          return;
        }
        if (result.ok) {
          provisionalProfileId = undefined;
          provisionalBaseline = undefined;
        }
        if (activeBefore && !deps.store.activeId) {
          const replacement = deps.store.save('Current setup', capture());
          deps.store.setActive(replacement.id);
        }
        const active = deps.store.active;
        if (result.ok && active && displaySourceId() && !deps.store.remoteUpdateAvailable) {
          applySettings(effectiveSettings(active.settings));
        }
      } finally {
        syncing = undefined;
      }
    })();
    return syncing;
  }

  function apply(id: string): void {
    flushAutosave();
    const profile = deps.store.profileById(id);
    if (!profile) return;
    applySettings(effectiveSettings(profile.settings, profile.id));
    deps.store.setActive(id);
  }

  function applyRemoteUpdate(): void {
    flushAutosave();
    const active = deps.store.active;
    if (!active) return;
    applySettings(effectiveSettings(active.settings));
    deps.store.markRemoteUpdateApplied();
  }

  function keepCurrentSetup(): void {
    flushAutosave();
    const active = deps.store.active;
    if (!active) return;
    updateFieldsByOwner(capture(), PORTABLE_PROFILE_SETTING_KEYS);
    deps.store.markRemoteUpdateApplied();
  }

  function saveNew(name: string): Profile {
    flushAutosave();
    const profile = deps.store.save(name, capture());
    deps.store.setActive(profile.id);
    return profile;
  }

  function remove(id: string): void {
    flushAutosave();
    const wasActive = deps.store.activeId === id;
    const wasDisplaySource = displaySourceId() === id;
    if (wasDisplaySource) deps.displaySource?.set(undefined);
    deps.store.remove(id);
    if (!wasActive) {
      if (wasDisplaySource && deps.store.active) applySettings(deps.store.active.settings);
      return;
    }
    const next = deps.store.profileById(deps.store.defaultId) ?? deps.store.profiles[0];
    if (next) {
      apply(next.id);
      return;
    }
    const replacement = deps.store.save('Current setup', capture());
    deps.store.setActive(replacement.id);
  }

  function suspend(): void {
    suspended = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingAutosaves.clear();
    deps.store.suspendPersistence();
  }

  function resume(): void {
    suspended = false;
    lastObserved = capture();
    deps.store.resumePersistence();
  }

  function dispose(): void {
    if (suspended) return;
    flushAutosave();
  }

  function setDisplaySource(id: string | undefined): void {
    flushAutosave();
    const next = id && deps.store.profileById(id) ? id : undefined;
    deps.displaySource?.set(next);
    const active = deps.store.active;
    if (active) applySettings(effectiveSettings(active.settings));
  }

  return {
    initialize,
    initializeFallback,
    sync,
    apply,
    applyRemoteUpdate,
    keepCurrentSetup,
    saveNew,
    remove,
    observeSettings,
    flushAutosave,
    dispose,
    suspend,
    resume,
    capture,
    setDisplaySource,
  };
}

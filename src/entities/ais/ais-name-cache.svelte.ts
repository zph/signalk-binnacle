import { cleanBoundedText, isFiniteNumber, isRecord } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import {
  arrayPersistedCodec,
  type PersistedCodec,
  PersistedValue,
  type StorageLike,
} from '$shared/settings';

export const AIS_NAME_CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHED_NAMES = 5_000;
const MAX_AIS_NAME_LENGTH = 128;
const MMSI_PATTERN = /^\d{9}$/;

interface PersistedAisName {
  mmsi: string;
  name: string;
  seenAt: number;
}

export interface CachedAisName {
  name: string;
  expiresAt: number;
}

const aisNameCodec: PersistedCodec<PersistedAisName> = {
  decode(value) {
    if (!isRecord(value)) return { state: 'invalid' };
    const mmsi = typeof value.mmsi === 'string' ? value.mmsi : '';
    const name = cleanBoundedText(value.name, MAX_AIS_NAME_LENGTH);
    if (
      !MMSI_PATTERN.test(mmsi) ||
      name === undefined ||
      !isFiniteNumber(value.seenAt) ||
      value.seenAt < 0 ||
      value.seenAt > 8.64e15
    ) {
      return { state: 'invalid' };
    }
    const clean = { mmsi, name, seenAt: value.seenAt };
    const exact = Object.keys(value).length === 3 && value.name === name && value.mmsi === mmsi;
    return { state: exact ? 'valid' : 'migrated', value: clean };
  },
};

const aisNamesCodec = arrayPersistedCodec(aisNameCodec, { maxItems: MAX_CACHED_NAMES });

// Names arrive in the slow AIS static report, separately from fast position reports. Keep the last
// name heard for each MMSI across target pruning and reconnects, but only for one rolling day.
export class AisNameCache {
  #persisted: PersistedValue<PersistedAisName[]>;
  #entries = new Map<string, PersistedAisName>();
  #now: () => number;

  constructor(storage?: StorageLike, now: () => number = Date.now) {
    this.#now = now;
    this.#persisted = new PersistedValue(
      binnacleStorageKey('aisNames'),
      [],
      storage,
      aisNamesCodec,
    );
    for (const entry of this.#persisted.value) {
      const previous = this.#entries.get(entry.mmsi);
      if (!previous || previous.seenAt < entry.seenAt) this.#entries.set(entry.mmsi, entry);
    }
    if (this.#pruneExpired(this.#now()) || this.#entries.size !== this.#persisted.value.length) {
      this.#persist();
    }
  }

  lookup(mmsi: string, now: number = this.#now()): CachedAisName | undefined {
    if (this.#pruneExpired(now)) this.#persist();
    const entry = this.#entries.get(mmsi);
    return entry
      ? { name: entry.name, expiresAt: entry.seenAt + AIS_NAME_CACHE_TTL_MS }
      : undefined;
  }

  remember(mmsi: string, rawName: unknown, seenAt: number = this.#now()): void {
    const name = cleanBoundedText(rawName, MAX_AIS_NAME_LENGTH);
    if (
      !MMSI_PATTERN.test(mmsi) ||
      name === undefined ||
      !isFiniteNumber(seenAt) ||
      seenAt < 0 ||
      seenAt > 8.64e15
    ) {
      return;
    }
    const now = this.#now();
    const pruned = this.#pruneExpired(now);
    if (seenAt + AIS_NAME_CACHE_TTL_MS <= now) {
      if (pruned) this.#persist();
      return;
    }
    const previous = this.#entries.get(mmsi);
    if (previous && previous.name === name && previous.seenAt >= seenAt) {
      if (pruned) this.#persist();
      return;
    }
    if (previous && previous.seenAt > seenAt) {
      if (pruned) this.#persist();
      return;
    }
    this.#entries.delete(mmsi);
    this.#entries.set(mmsi, { mmsi, name, seenAt });
    while (this.#entries.size > MAX_CACHED_NAMES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#persist();
  }

  #pruneExpired(now: number): boolean {
    let changed = false;
    for (const [mmsi, entry] of this.#entries) {
      if (entry.seenAt + AIS_NAME_CACHE_TTL_MS <= now) {
        this.#entries.delete(mmsi);
        changed = true;
      }
    }
    return changed;
  }

  #persist(): void {
    this.#persisted.set([...this.#entries.values()]);
  }
}

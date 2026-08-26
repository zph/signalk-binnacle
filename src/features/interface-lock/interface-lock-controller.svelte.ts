import type { PersistedValue } from '$shared/settings';

export interface InterfaceLockController {
  readonly locked: boolean;
  lock(): void;
  unlock(): void;
}

export function createInterfaceLockController(
  persisted: PersistedValue<boolean>,
): InterfaceLockController {
  return {
    get locked() {
      return persisted.value;
    },
    lock(): void {
      persisted.set(true);
    },
    unlock(): void {
      persisted.set(false);
    },
  };
}

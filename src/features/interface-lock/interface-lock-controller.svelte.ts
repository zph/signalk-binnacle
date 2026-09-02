export interface InterfaceLockController {
  readonly locked: boolean;
  lock(): void;
  unlock(): void;
}

// A helm lock protects the currently attended screen. It deliberately lives only for this page
// session: an automatic service-worker activation or a recovered browser tab must never strand a
// navigator behind a five-second hold control.
export function createInterfaceLockController(): InterfaceLockController {
  let locked = $state(false);
  return {
    get locked() {
      return locked;
    },
    lock(): void {
      locked = true;
    },
    unlock(): void {
      locked = false;
    },
  };
}

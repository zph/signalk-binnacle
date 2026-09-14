import { untrack } from 'svelte';
import { cleanBoundedText, uuidv4 } from '$shared/lib';
import type {
  InstrumentLayoutSet,
  InstrumentLayoutSnapshot,
  PersistedValue,
} from '$shared/settings';

function preset(id: string, name: string, tiles: string[], base: InstrumentLayoutSnapshot) {
  return {
    id,
    name,
    snapshot: {
      ...base,
      tiles,
      sizes: {},
      history: {},
      boxes: tiles.map((tile, i) => ({
        id: tile,
        x: 0.02 + (i % 2) * 0.49,
        y: 0.12 + Math.floor(i / 2) * 0.23,
        width: 0.47,
        height: 0.21,
      })),
    },
  };
}

export function createInstrumentLayoutsController(deps: {
  store: PersistedValue<InstrumentLayoutSet>;
  capture(): InstrumentLayoutSnapshot;
  apply(snapshot: InstrumentLayoutSnapshot): void;
}) {
  let menuOpen = $state(false);
  let observed: InstrumentLayoutSet | undefined;
  function defaults(base: InstrumentLayoutSnapshot) {
    return [
      preset('marina', 'Marina entry', ['depth', 'sog', 'heading', 'ais-radar'], base),
      preset('leisure', 'Leisure sailing', ['wind-rose', 'stw', 'depth', 'tides'], base),
      preset(
        'performance',
        'Sailing performance',
        ['polar-performance', 'wind-vmg', 'stw', 'course-vmg', 'twa-history', 'tws-history'],
        base,
      ),
    ];
  }
  function write(value: InstrumentLayoutSet) {
    deps.store.set(value);
    observed = deps.store.value;
  }
  function save() {
    const current = deps.store.value;
    const snapshot = deps.capture();
    if (!current.layouts.length) {
      write({
        active: 'custom',
        layouts: [{ id: 'custom', name: 'My instruments', snapshot }, ...defaults(snapshot)],
      });
    } else if (
      JSON.stringify(current.layouts.find((l) => l.id === current.active)?.snapshot) !==
      JSON.stringify(snapshot)
    ) {
      write({
        ...current,
        layouts: current.layouts.map((l) => (l.id === current.active ? { ...l, snapshot } : l)),
      });
    }
  }
  function select(id: string) {
    save();
    const target = deps.store.value.layouts.find((l) => l.id === id);
    if (!target) return;
    write({ ...deps.store.value, active: id });
    deps.apply(target.snapshot);
  }
  return {
    get layouts() {
      return deps.store.value.layouts;
    },
    get active() {
      return deps.store.value.layouts.find((l) => l.id === deps.store.value.active);
    },
    get menuOpen() {
      return menuOpen;
    },
    setMenuOpen(value: boolean) {
      menuOpen = value;
    },
    observe() {
      const current = deps.store.value;
      deps.capture();
      untrack(() => {
        if (current !== observed && current.layouts.length) {
          observed = current;
          const target = current.layouts.find((l) => l.id === current.active);
          if (target) deps.apply(target.snapshot);
        } else save();
      });
    },
    select,
    cycle(direction: number) {
      save();
      const current = deps.store.value;
      const index = current.layouts.findIndex((l) => l.id === current.active);
      select(
        current.layouts[(index + direction + current.layouts.length) % current.layouts.length].id,
      );
    },
    rename(name: string) {
      const clean = cleanBoundedText(name, 60);
      if (!clean) return;
      save();
      write({
        ...deps.store.value,
        layouts: deps.store.value.layouts.map((l) =>
          l.id === deps.store.value.active ? { ...l, name: clean } : l,
        ),
      });
    },
    duplicate(name: string) {
      save();
      const clean = cleanBoundedText(name, 60);
      if (!clean || deps.store.value.layouts.length >= 20) return;
      const id = uuidv4();
      write({
        active: id,
        layouts: [...deps.store.value.layouts, { id, name: clean, snapshot: deps.capture() }],
      });
    },
    restore() {
      const current = deps.store.value;
      const original = defaults(deps.capture()).find((l) => l.id === current.active);
      if (!original) return;
      write({
        ...current,
        layouts: current.layouts.map((l) => (l.id === original.id ? original : l)),
      });
      deps.apply(original.snapshot);
    },
  };
}

export type InstrumentLayoutsController = ReturnType<typeof createInstrumentLayoutsController>;

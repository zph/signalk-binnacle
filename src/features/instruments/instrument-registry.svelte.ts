import type { TileDef } from './tile-catalog';

export const INSTRUMENT_PLUGIN_API_VERSION = 1 as const;

export interface InstrumentPlugin {
  apiVersion: typeof INSTRUMENT_PLUGIN_API_VERSION;
  id: string;
  name: string;
  instruments: readonly TileDef[];
  // A plugin may resolve a bounded family of generated instruments, such as discovered battery
  // instances, before discovery has populated its visible catalog.
  resolve?: (id: string) => TileDef | undefined;
}

export interface InstrumentPluginInfo {
  id: string;
  name: string;
  instrumentCount: number;
  external: boolean;
}

export interface InstrumentRegistry {
  readonly catalog: readonly TileDef[];
  readonly plugins: readonly InstrumentPluginInfo[];
  readonly issues: readonly string[];
  register(plugin: InstrumentPlugin, scope?: string): () => void;
  replaceScope(scope: string, plugins: readonly InstrumentPlugin[]): void;
  resolve(id: string): TileDef | undefined;
  pluginFor(id: string): InstrumentPluginInfo | undefined;
}

interface RegisteredPlugin {
  plugin: InstrumentPlugin;
  scope: string;
  sequence: number;
}

const BUILTIN_SCOPE = 'binnacle';
const EXTERNAL_SCOPE = 'signalk-resources';

function isUsablePlugin(plugin: InstrumentPlugin): boolean {
  return (
    plugin.apiVersion === INSTRUMENT_PLUGIN_API_VERSION &&
    plugin.id.length > 0 &&
    plugin.name.length > 0 &&
    Array.isArray(plugin.instruments)
  );
}

export function createInstrumentRegistry(): InstrumentRegistry {
  let registrations = $state.raw<RegisteredPlugin[]>([]);
  let nextSequence = 0;

  const resolved = $derived.by(() => {
    const pluginIds = new Set<string>();
    const instrumentIds = new Set<string>();
    const catalog: TileDef[] = [];
    const plugins: InstrumentPluginInfo[] = [];
    const issues: string[] = [];

    for (const entry of registrations) {
      const { plugin } = entry;
      if (!isUsablePlugin(plugin)) {
        issues.push('An instrument plugin did not satisfy API version 1 and was ignored.');
        continue;
      }
      if (pluginIds.has(plugin.id)) {
        issues.push(`Instrument plugin ${plugin.id} was registered more than once.`);
        continue;
      }
      pluginIds.add(plugin.id);

      let count = 0;
      for (const instrument of plugin.instruments) {
        if (instrumentIds.has(instrument.id)) {
          issues.push(
            `Instrument ${instrument.id} from ${plugin.name} conflicts with another plugin.`,
          );
          continue;
        }
        instrumentIds.add(instrument.id);
        catalog.push(instrument);
        count += 1;
      }
      plugins.push({
        id: plugin.id,
        name: plugin.name,
        instrumentCount: count,
        external: entry.scope === EXTERNAL_SCOPE,
      });
    }
    return { catalog, plugins, issues };
  });

  function register(plugin: InstrumentPlugin, scope = BUILTIN_SCOPE): () => void {
    const sequence = nextSequence++;
    registrations = [...registrations, { plugin, scope, sequence }];
    return () => {
      registrations = registrations.filter((entry) => entry.sequence !== sequence);
    };
  }

  function replaceScope(scope: string, plugins: readonly InstrumentPlugin[]): void {
    const retained = registrations.filter((entry) => entry.scope !== scope);
    const replacements = plugins.map((plugin) => ({ plugin, scope, sequence: nextSequence++ }));
    registrations = [...retained, ...replacements];
  }

  function resolve(id: string): TileDef | undefined {
    const catalogEntry = resolved.catalog.find((instrument) => instrument.id === id);
    if (catalogEntry) return catalogEntry;
    for (const entry of registrations) {
      const generated = entry.plugin.resolve?.(id);
      if (generated) return generated;
    }
    return undefined;
  }

  function pluginFor(id: string): InstrumentPluginInfo | undefined {
    for (const info of resolved.plugins) {
      const registration = registrations.find((entry) => entry.plugin.id === info.id);
      if (!registration) continue;
      if (
        registration.plugin.instruments.some((instrument) => instrument.id === id) ||
        registration.plugin.resolve?.(id)
      ) {
        return info;
      }
    }
    return undefined;
  }

  return {
    get catalog() {
      return resolved.catalog;
    },
    get plugins() {
      return resolved.plugins;
    },
    get issues() {
      return resolved.issues;
    },
    register,
    replaceScope,
    resolve,
    pluginFor,
  };
}

export const SIGNALK_INSTRUMENT_PLUGIN_SCOPE = EXTERNAL_SCOPE;

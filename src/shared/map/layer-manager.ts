import type { ChartGroup } from 'signalk-chart-sources';

import type { MapThemePaint } from './map-theme';
import { installSentinels, sentinelId } from './sentinels';
import type { OverlayFacetPreset } from './types';
import {
  type BathymetryColorScheme,
  type CellPortrayalMode,
  type ChartCoverageInfo,
  type ChartLayerInfo,
  type DepthDisplayMode,
  type OverlayContext,
  type OverlayModule,
  Z_ORDER,
  type ZBand,
} from './types';

// Precomputed band-to-stacking-rank lookup so an overlay's band order is an O(1) read rather than a
// linear Z_ORDER scan on every effective-order pass.
const Z_RANK = new Map<ZBand, number>(Z_ORDER.map((band, i) => [band, i]));

export interface OverlayState {
  visible: boolean;
  opacity: number;
  cellSizeScale?: number;
  labelSizeScale?: number;
  displayDepth?: DepthDisplayMode;
  cellPortrayal?: CellPortrayalMode;
  bathymetryColorScheme?: BathymetryColorScheme;
}

// The visible, fully opaque state an overlay defaults to. Shared as a read-only reference; spread
// it before storing anywhere that mutates state in place.
export const DEFAULT_OVERLAY_STATE: OverlayState = { visible: true, opacity: 1 };

// Per-layer visibility and opacity, keyed by overlay id, for save and restore.
export type LayerSettings = Record<string, OverlayState>;

export interface LayerListItem {
  id: string;
  title: string;
  // A plain-language gloss for the row's hover tooltip. See OverlayModule.description.
  description?: string;
  visible: boolean;
  opacity: number;
  supportsOpacity: boolean;
  // A pinned layer (own vessel, active alarms) is locked to the top and cannot be reordered.
  pinned: boolean;
  // The overlay's z-band, used by the panel to group charts and depth apart from live overlays.
  band: ZBand;
  // The parent overlay id when this is a sub-layer (the panel nests it under its parent).
  parent?: string;
  // The named group this layer is a facet of, surfaced so the panel can render one group header
  // above the group's facets. See OverlayModule.group.
  group?: ChartGroup;
  // The Layers-panel category this layer declares. See OverlayModule.category.
  category?: string;
  // The region tag (US, EU, Global) shown on the row. See OverlayModule.region.
  region?: string;
  // False when the overlay's provider or data is absent: the panel grays the row and disables its
  // toggle. See OverlayModule.available. layers() synchronizes the rendered visibility and takes
  // an availability snapshot, so the host calls LayersView.refresh() when an availability-gating
  // value changes (App.svelte does this in an effect).
  available: boolean;
  // The hover tooltip for a grayed-out row. See OverlayModule.unavailableHint.
  unavailableHint?: string;
  // The row has a settings gear that asks the host to open this overlay's controls. See
  // OverlayModule.manageable.
  manageable?: boolean;
  // Present when this row represents a chart source, so the Layers panel can expose chart-source
  // detail without knowing how the overlay renders.
  chart?: ChartLayerInfo;
  cellSizeControl?: OverlayModule['cellSizeControl'];
  cellSizeScale?: number;
  labelSizeControl?: OverlayModule['labelSizeControl'];
  labelSizeScale?: number;
  // Present when the overlay declares depthDisplayControl: the depth-display and portrayal
  // choices persisted for the row, so the panel can offer the controls again after a reload.
  depthDisplayControl?: boolean;
  displayDepth?: DepthDisplayMode;
  cellPortrayal?: CellPortrayalMode;
  bathymetryColorScheme?: BathymetryColorScheme;
  // Present when this row is a navigation chart the ambient chart badge counts. See
  // OverlayModule.chartCoverage.
  chartCoverage?: ChartCoverageInfo;
  facetPresets?: readonly OverlayFacetPreset[];
}

export interface LayerManagerOptions {
  // Settings to restore on register (a layer absent here takes the visible default).
  saved?: LayerSettings;
  // Called with the full settings snapshot whenever a layer's state changes.
  onChange?: (settings: LayerSettings) => void;
  // Persisted bottom-to-top order of non-pinned overlay ids, and the callback to persist it.
  savedOrder?: string[];
  onOrderChange?: (order: string[]) => void;
  // Overlay ids pinned to the top of the stack, in bottom-to-top order, so the vessel and
  // active alarms can never be hidden beneath a chart. The core stays generic: the wiring
  // decides which ids are pinned rather than the manager hardcoding any feature.
  pinned?: string[];
  // Groups of overlay ids that are mutually exclusive: enabling one hides the others in its group.
  // The wiring decides the groups (the weather area fills) rather than the manager hardcoding any.
  exclusive?: string[][];
}

type LayerRegistrationResult =
  | { id: string; status: 'registered' }
  | { id: string; status: 'failed'; error: unknown };

interface ActiveRegistration {
  module: OverlayModule;
  canceled: boolean;
}

export class LayerManager {
  #ctx: OverlayContext;
  #modules = new Map<string, OverlayModule>();
  #state = new Map<string, OverlayState>();
  // Provider availability is runtime-only. Keep it separate from the desired, persisted visibility
  // in #state so an unavailable overlay is hidden on the map without losing the user's preference.
  #availability = new Map<string, boolean>();
  #renderedVisibility = new Map<string, boolean>();
  // An async add can be canceled by unregister before it finishes. Keep its identity and completion
  // task separate from the public module map so a same-id replacement waits for the canceled add's
  // final cleanup, and a stale catch cannot delete the replacement's state.
  #registrations = new Map<string, ActiveRegistration>();
  #registrationTasks = new Map<string, Promise<void>>();
  #disposed = false;
  #saved: LayerSettings;
  #onChange?: (settings: LayerSettings) => void;
  // The explicit user order (bottom to top) of non-pinned overlays; seeds the effective order.
  #explicitOrder: string[];
  #onOrderChange?: (order: string[]) => void;
  #pinned: Set<string>;
  #exclusive: string[][];
  // The last theme paint broadcast, so a module registered after the first recolor (an imported
  // user chart) is themed at add time instead of staying day-colored until the next theme change.
  #lastPaint?: MapThemePaint;

  constructor(ctx: OverlayContext, options: LayerManagerOptions = {}) {
    this.#ctx = ctx;
    this.#saved = options.saved ?? {};
    this.#onChange = options.onChange;
    this.#explicitOrder = options.savedOrder ? [...options.savedOrder] : [];
    this.#onOrderChange = options.onOrderChange;
    this.#pinned = new Set(options.pinned ?? []);
    this.#exclusive = options.exclusive ?? [];
  }

  async register(module: OverlayModule): Promise<void> {
    await this.#addModuleTree(module);
    this.#applyOrder();
  }

  // Replace one registered overlay without changing its persisted visibility, opacity, or stacking
  // slot. A failed replacement restores the prior module before rejecting, so editing a saved chart
  // source cannot turn a working chart into a silent empty layer.
  async replace(module: OverlayModule): Promise<void> {
    if (this.#disposed) throw new Error('layer manager is disposed');
    const pending = this.#registrationTasks.get(module.id);
    if (pending) await pending;
    if (this.#disposed) throw new Error('layer manager is disposed');
    const previousRegistration = this.#registrations.get(module.id);
    const previous = previousRegistration?.module ?? this.#modules.get(module.id);
    if (!previous) {
      await this.register(module);
      return;
    }
    const retainedStates = new Map<string, OverlayState>();
    for (const id of [module.id, ...this.#childrenOf(module.id)]) {
      const current = this.#state.get(id);
      if (current) retainedStates.set(id, { ...current });
    }
    if (!retainedStates.has(module.id)) {
      retainedStates.set(module.id, {
        visible: previous.defaultVisible ?? true,
        opacity: previous.defaultOpacity ?? 1,
      });
    }

    try {
      previous.remove(this.#ctx);
    } catch (error) {
      throw new Error(`Could not remove overlay "${module.id}" for replacement.`, {
        cause: error,
      });
    }
    for (const childId of this.#childrenOf(module.id).reverse()) this.#removeModule(childId);
    this.#registrations.delete(module.id);
    this.#modules.delete(module.id);
    this.#state.delete(module.id);
    this.#availability.delete(module.id);
    this.#renderedVisibility.delete(module.id);

    try {
      await this.#addModuleTree(module, retainedStates);
      this.#applyOrder();
    } catch (replacementError) {
      for (const childId of this.#childrenOf(module.id).reverse()) this.#removeModule(childId);
      this.#removeModule(module.id);
      try {
        await this.#addModuleTree(previous, retainedStates);
        this.#applyOrder();
      } catch (restoreError) {
        throw new AggregateError(
          [replacementError, restoreError],
          `Could not replace or restore overlay "${module.id}".`,
        );
      }
      throw replacementError;
    }
  }

  // Register many overlays as one batch, applying the stacking order a single time at the end
  // rather than after every module. The initial chart-plus-overlay load registers a dozen or more
  // modules, and a per-register restack is a moveLayer chain over every layer each time, so the
  // batch turns a quadratic load-time cost into one restack. The final order is identical to
  // registering the same modules in the same sequence one at a time.
  async registerAll(modules: OverlayModule[]): Promise<void> {
    const results = await this.registerBatch(modules);
    const failures = results.filter(
      (result): result is Extract<LayerRegistrationResult, { status: 'failed' }> =>
        result.status === 'failed',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        `Could not register ${failures.length} overlay${failures.length === 1 ? '' : 's'}.`,
      );
    }
  }

  // Register independent overlay modules without allowing one optional provider failure to prevent
  // the remaining modules from mounting. Each failed add is rolled back by #addModule, registration
  // order is preserved, and the map is restacked exactly once after the batch settles.
  async registerBatch(modules: OverlayModule[]): Promise<LayerRegistrationResult[]> {
    const results: LayerRegistrationResult[] = [];
    for (const module of modules) {
      try {
        await this.#addModuleTree(module);
        results.push({ id: module.id, status: 'registered' });
      } catch (error) {
        results.push({ id: module.id, status: 'failed', error });
      }
    }
    this.#applyOrder();
    return results;
  }

  // Register a parent and its declarative facets as one logical unit. Facets are lightweight
  // virtual modules: they share the parent's sources and add/remove lifecycle, but retain their own
  // persisted visibility and opacity. A failed child rolls the whole tree back.
  async #addModuleTree(
    module: OverlayModule,
    retainedStates: ReadonlyMap<string, OverlayState> = new Map(),
  ): Promise<void> {
    const facetModules = this.#facetModules(module);
    const ids = [module.id, ...facetModules.map((facet) => facet.id)];
    if (new Set(ids).size !== ids.length) {
      throw new Error(`duplicate overlay facet id under: ${module.id}`);
    }
    const added: string[] = [];
    try {
      await this.#addModule(module, retainedStates.get(module.id));
      added.push(module.id);
      for (const facet of facetModules) {
        await this.#addModule(facet, retainedStates.get(facet.id));
        added.push(facet.id);
      }
    } catch (error) {
      for (const id of added.reverse()) this.#removeModule(id);
      throw error;
    }
  }

  #facetModules(parent: OverlayModule): OverlayModule[] {
    return (parent.facets ?? []).map((facet) => ({
      id: facet.id,
      title: facet.title,
      description: facet.description,
      band: parent.band,
      parent: parent.id,
      group: parent.group,
      category: parent.category,
      region: parent.region,
      listed: parent.listed,
      supportsOpacity: facet.supportsOpacity,
      defaultVisible: facet.defaultVisible,
      defaultOpacity: facet.defaultOpacity,
      layerIds: facet.layerIds,
      add() {},
      remove() {},
      setVisible: facet.setVisible,
      setOpacity: facet.setOpacity,
    }));
  }

  // Add a single module (state restore, exclusion enforcement, add, visibility, and opacity)
  // without restacking. register and registerAll share this and own when #applyOrder runs.
  async #addModule(module: OverlayModule, retainedState?: OverlayState): Promise<void> {
    if (this.#disposed) throw new Error('layer manager is disposed');
    const previous = this.#registrationTasks.get(module.id);
    if (previous) await previous.catch(() => undefined);
    if (this.#disposed) throw new Error('layer manager is disposed');
    if (this.#modules.has(module.id)) {
      throw new Error(`duplicate overlay id: ${module.id}`);
    }
    const registration: ActiveRegistration = { module, canceled: false };
    this.#registrations.set(module.id, registration);
    this.#modules.set(module.id, module);
    const restored = retainedState ?? this.#saved[module.id];
    // Coerce a restored state's shape: a legacy persisted entry missing opacity would otherwise
    // flow undefined into setOpacity and render as NaN.
    const state = restored
      ? {
          visible: this.#flooredVisible(module.id, Boolean(restored.visible)),
          opacity: this.#coerceOpacity(restored.opacity),
          ...(module.cellSizeControl
            ? {
                cellSizeScale: this.#coerceCellSizeScale(
                  module.cellSizeControl,
                  restored.cellSizeScale,
                ),
              }
            : {}),
          ...(module.labelSizeControl
            ? {
                labelSizeScale: this.#coerceScale(module.labelSizeControl, restored.labelSizeScale),
              }
            : {}),
          ...(module.depthDisplayControl
            ? {
                displayDepth: this.#coerceDepthDisplay(restored.displayDepth),
                cellPortrayal: this.#coerceCellPortrayal(restored.cellPortrayal),
                bathymetryColorScheme: this.#coerceBathymetryColorScheme(
                  restored.bathymetryColorScheme,
                ),
              }
            : {}),
        }
      : {
          visible: module.defaultVisible ?? true,
          opacity: module.defaultOpacity ?? 1,
          ...(module.cellSizeControl ? { cellSizeScale: module.cellSizeControl.default } : {}),
          ...(module.labelSizeControl ? { labelSizeScale: module.labelSizeControl.default } : {}),
          ...(module.depthDisplayControl
            ? {
                displayDepth: 'predicted' as DepthDisplayMode,
                cellPortrayal: 'text' as CellPortrayalMode,
                bathymetryColorScheme: 'noaa-chart' as BathymetryColorScheme,
              }
            : {}),
        };
    // Enforce exclusion on restore too: a saved or legacy state with two members of an exclusive
    // group both visible would otherwise bypass the toggle-time rule. Keep the first registered.
    if (state.visible) {
      const group = this.#groupOf(module.id);
      if (group?.some((other) => other !== module.id && this.#state.get(other)?.visible)) {
        state.visible = this.#flooredVisible(module.id, false);
      }
    }
    this.#state.set(module.id, state);
    const task = this.#finishAdd(module, state, registration);
    this.#registrationTasks.set(module.id, task);
    try {
      await task;
    } finally {
      if (this.#registrationTasks.get(module.id) === task) {
        this.#registrationTasks.delete(module.id);
      }
    }
  }

  async #finishAdd(
    module: OverlayModule,
    state: OverlayState,
    registration: ActiveRegistration,
  ): Promise<void> {
    let removedAfterAdd = false;
    try {
      if (module.cellSizeControl && state.cellSizeScale !== undefined) {
        module.setCellSizeScale?.(this.#ctx, state.cellSizeScale);
      }
      if (module.labelSizeControl && state.labelSizeScale !== undefined) {
        module.setLabelSizeScale?.(this.#ctx, state.labelSizeScale);
      }
      if (module.depthDisplayControl) {
        if (state.displayDepth) module.setDisplayDepth?.(this.#ctx, state.displayDepth);
        if (state.cellPortrayal) module.setCellPortrayal?.(this.#ctx, state.cellPortrayal);
        if (state.bathymetryColorScheme) {
          module.setBathymetryColorScheme?.(this.#ctx, state.bathymetryColorScheme);
        }
      }
      await module.add(this.#ctx);
      // An async add can finish after the owning map has been torn down or the id was unregistered.
      // The first remove cleans partial work immediately; this second pass removes anything the late
      // continuation installed. A replacement cannot start until this task settles.
      if (
        this.#disposed ||
        registration.canceled ||
        this.#registrations.get(module.id) !== registration
      ) {
        try {
          module.remove(this.#ctx);
        } catch {
          // The map or the first cleanup may already have removed every resource.
        }
        removedAfterAdd = true;
        throw new Error(
          this.#disposed ? 'layer manager is disposed' : 'overlay registration canceled',
        );
      }
      // `state` is the exact object held in #state, and the visibility and opacity setters mutate
      // it in place, so this re-apply picks up changes made while add() was awaited. Overlays skip
      // paint updates until their layers exist, and this pass is what recovers those skips; if
      // #state ever moves to replace-on-write, this must re-read the current entry instead.
      this.#syncVisibility(module, state, true);
      this.#syncOpacity(module, state);
      this.#syncChildOpacities(module.id);
      if (this.#lastPaint) module.applyTheme?.(this.#ctx, this.#lastPaint);
    } catch (error) {
      if (!removedAfterAdd) {
        try {
          module.remove(this.#ctx);
        } catch {
          // Best-effort rollback: an add that failed before creating map resources may have nothing
          // to remove. The original add error is the useful failure for the caller.
        }
      }
      if (this.#registrations.get(module.id) === registration) {
        this.#registrations.delete(module.id);
        this.#modules.delete(module.id);
        this.#state.delete(module.id);
        this.#availability.delete(module.id);
        this.#renderedVisibility.delete(module.id);
      }
      throw error;
    }
  }

  unregister(id: string, options: { preserveProfileState?: boolean } = {}): void {
    const childIds = this.#childrenOf(id);
    for (const childId of childIds.reverse()) this.#removeModule(childId);
    this.#removeModule(id);
    // A deliberate removal, such as deleting a user chart, clears its saved state and order. A
    // provider refresh temporarily unregisters the same logical chart, so it retains the parent,
    // every facet, and the stacking slot for the replacement registration.
    if (!options.preserveProfileState) {
      for (const removedId of [id, ...childIds]) delete this.#saved[removedId];
      if (this.#explicitOrder.includes(id)) {
        this.#explicitOrder = this.#explicitOrder.filter((other) => other !== id);
        this.#onOrderChange?.([...this.#explicitOrder]);
      }
    }
    this.#persist();
  }

  #removeModule(id: string): void {
    const registration = this.#registrations.get(id);
    const module = registration?.module ?? this.#modules.get(id);
    if (!module) return;
    if (registration) registration.canceled = true;
    try {
      module.remove(this.#ctx);
    } catch (error) {
      console.warn(`Could not remove overlay "${module.id}".`, error);
    }
    if (!registration || this.#registrations.get(id) === registration) {
      this.#registrations.delete(id);
      this.#modules.delete(id);
      this.#state.delete(id);
      this.#availability.delete(id);
      this.#renderedVisibility.delete(id);
    }
  }

  #childrenOf(id: string): string[] {
    return [...this.#modules]
      .filter(([, module]) => module.parent === id)
      .map(([childId]) => childId);
  }

  // Tear down every registered module before the owning MapLibre instance is removed. Reverse
  // registration order mirrors stack unwinding, and clearing first makes repeated disposal a no-op
  // even if one module's cleanup throws through a host integration.
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const registration of this.#registrations.values()) registration.canceled = true;
    const modules = [...this.#modules.values()].reverse();
    this.#registrations.clear();
    this.#modules.clear();
    this.#state.clear();
    this.#availability.clear();
    this.#renderedVisibility.clear();
    for (const module of modules) {
      try {
        module.remove(this.#ctx);
      } catch (error) {
        console.warn(`Could not remove overlay "${module.id}".`, error);
      }
    }
  }

  toggle(id: string, visible: boolean): void {
    // A request the pinned floor overrides is ignored outright rather than clamped: clamping would
    // re-run exclusion, child restore, and a persist for a state that did not change.
    if (this.#flooredVisible(id, visible) !== visible) return;
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state) return;
    // Enabling a member of an exclusive group hides the other members of that group.
    if (visible) {
      const group = this.#groupOf(id);
      for (const other of group ?? []) {
        if (other === id) continue;
        const om = this.#modules.get(other);
        const os = this.#state.get(other);
        if (om && os?.visible && !this.#flooredVisible(other, false)) {
          os.visible = false;
          this.#syncVisibility(om, os, true);
        }
      }
    }
    state.visible = visible;
    this.#syncVisibility(module, state, true);
    // Child visibility is desired state, independent of the parent's temporary visibility. The
    // rendered-visibility calculation below gates children through their parent without rewriting
    // or persisting their choices, so a parent off-on round trip survives reloads and refreshes.
    this.#syncChildren(id);
    this.#persist();
  }

  #syncChildren(id: string): void {
    for (const childId of this.#childrenOf(id)) {
      const child = this.#modules.get(childId);
      const childState = this.#state.get(childId);
      if (child && childState) this.#syncVisibility(child, childState, true);
    }
  }

  setOpacity(id: string, opacity: number, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state) return;
    if (state.opacity !== opacity) {
      state.opacity = opacity;
      this.#syncOpacity(module, state);
      this.#syncChildOpacities(id);
    }
    if (persist) this.#persist();
  }

  // A separately rendered child inherits the opacity of every separately rendered parent, while
  // retaining its own persisted opacity as a local adjustment. Declarative facets are different:
  // their parent module owns the same MapLibre layers and already multiplies parent and facet
  // opacity internally, so passing a multiplied value to those virtual child modules would apply
  // the parent twice.
  #syncOpacity(module: OverlayModule, state: OverlayState): void {
    let opacity = state.opacity;
    let current = module;
    const seen = new Set<string>([module.id]);
    while (current.parent !== undefined) {
      const parent = this.#modules.get(current.parent);
      const parentState = this.#state.get(current.parent);
      if (!parent || !parentState || seen.has(parent.id)) break;
      if (parent.facets?.some((facet) => facet.id === current.id)) break;
      opacity *= parentState.opacity;
      seen.add(parent.id);
      current = parent;
    }
    module.setOpacity?.(this.#ctx, opacity);
  }

  #syncChildOpacities(parentId: string, seen = new Set<string>()): void {
    if (seen.has(parentId)) return;
    seen.add(parentId);
    const parent = this.#modules.get(parentId);
    for (const [childId, child] of this.#modules) {
      if (child.parent !== parentId) continue;
      // The owning parent redraws declarative facets when its own opacity changes.
      if (!parent?.facets?.some((facet) => facet.id === childId)) {
        const childState = this.#state.get(childId);
        if (childState) this.#syncOpacity(child, childState);
      }
      this.#syncChildOpacities(childId, seen);
    }
  }

  applyFacetPreset(parentId: string, visibility: Readonly<Record<string, boolean>>): void {
    const parent = this.#modules.get(parentId);
    if (!parent) return;
    let changed = false;
    for (const [id, visible] of Object.entries(visibility)) {
      const module = this.#modules.get(id);
      const state = this.#state.get(id);
      if (!module || module.parent !== parentId || !state || state.visible === visible) continue;
      state.visible = visible;
      this.#syncVisibility(module, state, true);
      changed = true;
    }
    if (!changed) return;
    this.#persist();
  }

  setCellSizeScale(id: string, scale: number, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    const control = module?.cellSizeControl;
    if (!module || !state || !control) return;
    const next = this.#coerceCellSizeScale(control, scale);
    if (state.cellSizeScale !== next) {
      state.cellSizeScale = next;
      module.setCellSizeScale?.(this.#ctx, next);
    }
    if (persist) this.#persist();
  }

  setLabelSizeScale(id: string, scale: number, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    const control = module?.labelSizeControl;
    if (!module || !state || !control) return;
    const next = this.#coerceScale(control, scale);
    if (state.labelSizeScale !== next) {
      state.labelSizeScale = next;
      module.setLabelSizeScale?.(this.#ctx, next);
    }
    if (persist) this.#persist();
  }

  setDisplayDepth(id: string, mode: DepthDisplayMode, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state || !module.depthDisplayControl) return;
    const next = this.#coerceDepthDisplay(mode);
    if (state.displayDepth !== next) {
      state.displayDepth = next;
      module.setDisplayDepth?.(this.#ctx, next);
    }
    if (persist) this.#persist();
  }

  setCellPortrayal(id: string, mode: CellPortrayalMode, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state || !module.depthDisplayControl) return;
    const next = this.#coerceCellPortrayal(mode);
    if (state.cellPortrayal !== next) {
      state.cellPortrayal = next;
      module.setCellPortrayal?.(this.#ctx, next);
    }
    if (persist) this.#persist();
  }

  setBathymetryColorScheme(id: string, scheme: BathymetryColorScheme, persist = true): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state || !module.depthDisplayControl) return;
    const next = this.#coerceBathymetryColorScheme(scheme);
    if (state.bathymetryColorScheme !== next) {
      state.bathymetryColorScheme = next;
      module.setBathymetryColorScheme?.(this.#ctx, next);
    }
    if (persist) this.#persist();
  }

  // Move a non-pinned overlay to a new index in the non-pinned, top-to-bottom display order
  // (index 0 is the top of the map). Pinned layers are never moved or displaced.
  reorder(id: string, toIndex: number): void {
    if (this.#pinned.has(id) || !this.#modules.has(id)) return;
    // A sub-layer is never reordered on its own; it stays directly above its parent.
    if (this.#isChild(id)) return;
    const topDown = this.#effectiveOrder()
      .filter((other) => !this.#pinned.has(other) && !this.#isChild(other))
      .reverse();
    const from = topDown.indexOf(id);
    topDown.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, topDown.length));
    topDown.splice(clamped, 0, id);
    this.#explicitOrder = topDown.reverse();
    this.#applyOrder();
    this.#onOrderChange?.([...this.#explicitOrder]);
  }

  // Reorder one member inside a filtered top-level subset while leaving every row outside that
  // subset in its existing stack slot. The Charts view uses this because a restored legacy order
  // can interleave charts with non-chart overlays that are not visible in that view; dragging a
  // chart must not silently move one of those hidden overlays too.
  reorderSubset(id: string, subsetIds: string[], toIndex: number): void {
    if (this.#pinned.has(id) || !this.#modules.has(id) || this.#isChild(id)) return;
    const topDown = this.#effectiveOrder()
      .filter((other) => !this.#pinned.has(other) && !this.#isChild(other))
      .reverse();
    const requested = new Set(subsetIds);
    const subset = topDown.filter((other) => requested.has(other));
    const from = subset.indexOf(id);
    if (from < 0) return;
    subset.splice(from, 1);
    subset.splice(Math.max(0, Math.min(toIndex, subset.length)), 0, id);

    let subsetIndex = 0;
    const reordered = topDown.map((other) =>
      requested.has(other) ? (subset[subsetIndex++] ?? other) : other,
    );
    this.#explicitOrder = reordered.reverse();
    this.#applyOrder();
    this.#onOrderChange?.([...this.#explicitOrder]);
  }

  // Apply a full settings snapshot and a new explicit stacking order in one pass, for profile
  // switching. The batch persists and fires the order-change callback exactly once at the end
  // rather than per layer, so swapping a profile is a single store write and a single restack.
  // It deliberately does NOT re-run exclusive-group enforcement: the snapshot was a valid state
  // when it was captured, so re-enforcing here could suppress a layer the saved profile kept on.
  applySnapshot(settings: LayerSettings, order: string[]): void {
    if (this.#disposed) return;
    this.#saved = Object.fromEntries(
      Object.entries(settings).map(([id, state]) => [id, { ...state }]),
    );
    for (const [id, module] of this.#modules) {
      // Same filter as #persist: an id left behind by a build that did persist these must not be
      // able to reapply itself to a transient overlay.
      if (module.listed === false) continue;
      const next = settings[id];
      const state = this.#state.get(id);
      if (!next || !state) continue;
      const nextVisible = this.#flooredVisible(id, next.visible);
      let visibilityChanged = false;
      if (nextVisible !== state.visible) {
        state.visible = nextVisible;
        visibilityChanged = true;
      }
      this.#syncVisibility(module, state, visibilityChanged);
      // Coerce as #addModule does: a corrupted or legacy snapshot opacity (NaN or out of range)
      // would otherwise flow into setOpacity and render the layer transparent or broken.
      const opacity = this.#coerceOpacity(next.opacity);
      if (opacity !== state.opacity) {
        state.opacity = opacity;
        this.#syncOpacity(module, state);
        this.#syncChildOpacities(id);
      }
      if (module.cellSizeControl) {
        const cellSizeScale = this.#coerceCellSizeScale(module.cellSizeControl, next.cellSizeScale);
        if (cellSizeScale !== state.cellSizeScale) {
          state.cellSizeScale = cellSizeScale;
          module.setCellSizeScale?.(this.#ctx, cellSizeScale);
        }
      }
      if (module.labelSizeControl) {
        const labelSizeScale = this.#coerceScale(module.labelSizeControl, next.labelSizeScale);
        if (labelSizeScale !== state.labelSizeScale) {
          state.labelSizeScale = labelSizeScale;
          module.setLabelSizeScale?.(this.#ctx, labelSizeScale);
        }
      }
      if (module.depthDisplayControl) {
        const displayDepth = this.#coerceDepthDisplay(next.displayDepth);
        if (displayDepth !== state.displayDepth) {
          state.displayDepth = displayDepth;
          module.setDisplayDepth?.(this.#ctx, displayDepth);
        }
        const cellPortrayal = this.#coerceCellPortrayal(next.cellPortrayal);
        if (cellPortrayal !== state.cellPortrayal) {
          state.cellPortrayal = cellPortrayal;
          module.setCellPortrayal?.(this.#ctx, cellPortrayal);
        }
        const bathymetryColorScheme = this.#coerceBathymetryColorScheme(next.bathymetryColorScheme);
        if (bathymetryColorScheme !== state.bathymetryColorScheme) {
          state.bathymetryColorScheme = bathymetryColorScheme;
          module.setBathymetryColorScheme?.(this.#ctx, bathymetryColorScheme);
        }
      }
    }
    this.#explicitOrder = [...order];
    this.#applyOrder();
    this.#persist();
    this.#onOrderChange?.([...this.#explicitOrder]);
  }

  // An unlisted overlay is transient session machinery (the time-travel marker and track, the
  // measure overlay), not a layer the navigator owns. They are registered for the life of the map
  // like every other overlay, so without this filter their ids landed in the persisted snapshot on
  // the first persist of every session, and from there into the profile document that merges across
  // devices. Nothing can toggle them from the panel, so the entries were pure noise in a record
  // that is supposed to describe the navigator's choices.
  #persist(): void {
    const snapshot: LayerSettings = {};
    for (const [id, state] of this.#state) {
      if (this.#modules.get(id)?.listed === false) continue;
      snapshot[id] = {
        visible: state.visible,
        opacity: state.opacity,
        ...(this.#modules.get(id)?.cellSizeControl && state.cellSizeScale !== undefined
          ? { cellSizeScale: state.cellSizeScale }
          : {}),
        ...(this.#modules.get(id)?.labelSizeControl && state.labelSizeScale !== undefined
          ? { labelSizeScale: state.labelSizeScale }
          : {}),
        ...(this.#modules.get(id)?.depthDisplayControl && state.displayDepth !== undefined
          ? { displayDepth: state.displayDepth }
          : {}),
        ...(this.#modules.get(id)?.depthDisplayControl && state.cellPortrayal !== undefined
          ? { cellPortrayal: state.cellPortrayal }
          : {}),
        ...(this.#modules.get(id)?.depthDisplayControl && state.bathymetryColorScheme !== undefined
          ? { bathymetryColorScheme: state.bathymetryColorScheme }
          : {}),
      };
    }
    // Keep the manager's restore source current even without a persistence callback. A profile can
    // be applied before an asynchronously discovered chart registers; its facet settings must still
    // be available when that chart family arrives later.
    const persisted = { ...this.#saved, ...snapshot };
    this.#saved = persisted;
    this.#onChange?.(persisted);
  }

  #isChild(id: string): boolean {
    return this.#modules.get(id)?.parent !== undefined;
  }

  // Clamp a restored or snapshot opacity into [0, 1]: a legacy persisted entry missing opacity, or
  // a corrupted out-of-range value, would otherwise flow undefined or NaN into setOpacity and
  // render the layer as NaN, transparent, or broken.
  #coerceOpacity(value: unknown): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 1;
  }

  #coerceCellSizeScale(
    control: NonNullable<OverlayModule['cellSizeControl']>,
    value: unknown,
  ): number {
    return this.#coerceScale(control, value);
  }

  #coerceScale(control: NonNullable<OverlayModule['labelSizeControl']>, value: unknown): number {
    if (!Number.isFinite(value)) return control.default;
    const clamped = Math.max(control.minimum, Math.min(control.maximum, value as number));
    const steps = Math.round((clamped - control.minimum) / control.step);
    return Math.min(control.maximum, control.minimum + steps * control.step);
  }

  // A missing or unrecognized depth-display or portrayal value falls back to the configured default, so
  // settings saved by an older build (or a corrupted write) still restore a coherent portrayal.
  #coerceDepthDisplay(value: unknown): DepthDisplayMode {
    return value === 'conservative' ? 'conservative' : 'predicted';
  }

  #coerceCellPortrayal(value: unknown): CellPortrayalMode {
    return value === 'shaded' ? 'shaded' : 'text';
  }

  #coerceBathymetryColorScheme(value: unknown): BathymetryColorScheme {
    return value === 'safety' ? 'safety' : 'noaa-chart';
  }

  // The pinned safety floor: no door lowers a pinned overlay's visibility. Not the panel toggle,
  // not a saved or synced profile snapshot, not a parent or exclusive-group hide. The panel renders
  // no toggle for a pinned row, so a false arriving at any door is a corrupted or foreign write,
  // never a choice, and a floor one door can lower is not a floor.
  #flooredVisible(id: string, visible: boolean): boolean {
    return visible || this.#pinned.has(id);
  }

  // Apply the rendered visibility when the desired state changes or a provider appears or
  // disappears. Availability never mutates #state, so persistence and provider recovery retain the
  // user's choice while the map and disabled panel control remain aligned.
  #syncVisibility(module: OverlayModule, state: OverlayState, force = false): boolean {
    const available = module.available?.() ?? true;
    const parentState = module.parent ? this.#state.get(module.parent) : undefined;
    const parentAvailable = module.parent ? (this.#availability.get(module.parent) ?? true) : true;
    const parentVisible = parentState ? parentAvailable && parentState.visible : true;
    const renderedVisible = available && state.visible && parentVisible;
    if (
      force ||
      this.#availability.get(module.id) !== available ||
      this.#renderedVisibility.get(module.id) !== renderedVisible
    ) {
      module.setVisible(this.#ctx, renderedVisible);
      this.#availability.set(module.id, available);
      this.#renderedVisibility.set(module.id, renderedVisible);
    }
    return available;
  }

  #refreshAvailability(): void {
    for (const [id, module] of this.#modules) {
      const state = this.#state.get(id);
      if (state) this.#syncVisibility(module, state);
    }
  }

  #groupOf(id: string): string[] | undefined {
    return this.#exclusive.find((g) => g.includes(id));
  }

  // The effective stacking order, bottom to top: pinned overlays on top, the rest by the
  // saved explicit order, with any overlay missing from it slotted in at its band default.
  // Recomputed per call rather than memoized: the overlay count is small (a dozen at most) and a
  // cache would need invalidating on every register, unregister, reorder, pin, and snapshot, where a
  // stale entry would mis-stack layers.
  #effectiveOrder(): string[] {
    const bandRank = (id: string): number =>
      Z_RANK.get(this.#modules.get(id)?.band ?? 'basemap') ?? 0;
    const nonPinned = [...this.#modules.keys()].filter((id) => !this.#pinned.has(id));
    // Order the top-level overlays only. A sub-layer is not positioned on its own: it is slotted
    // directly above its parent below, so it never drifts from the chart it annotates and never
    // becomes its own reorderable row.
    const topLevel = new Set(nonPinned.filter((id) => !this.#isChild(id)));
    const seq = this.#explicitOrder.filter((id) => topLevel.has(id));
    // inSeq tracks membership in seq for O(1) has-check; posInSeq maps id to index for O(1) parent
    // lookup. Both are kept in sync with every splice so the findIndex loop below stays off seq.
    const inSeq = new Set(seq);
    const posInSeq = new Map(seq.map((id, i) => [id, i]));
    // Precompute band ranks for the current seq contents so the insertion loop never calls
    // bandRank(other) per element.
    const seqRanks: number[] = seq.map((id) => bandRank(id));
    for (const id of topLevel) {
      if (inSeq.has(id)) continue;
      const rank = bandRank(id);
      let at = seqRanks.findIndex((r) => r > rank);
      if (at < 0) at = seq.length;
      seq.splice(at, 0, id);
      seqRanks.splice(at, 0, rank);
      inSeq.add(id);
      // posInSeq is used only for parent lookup below, so a full rebuild is acceptable here;
      // the number of top-level overlays is small (a dozen at most) and this path runs once per
      // missing id, not per element per insertion.
      for (let k = at; k < seq.length; k++) posInSeq.set(seq[k], k);
    }
    // How many children each parent has already taken, so the next one lands above its siblings
    // rather than at parent + 1 again: inserting every child at the same slot would stack them in
    // reverse registration order, against this file's bottom-to-top registration invariant.
    const childCount = new Map<string, number>();
    for (const id of nonPinned) {
      const parent = this.#modules.get(id)?.parent;
      if (parent === undefined) continue;
      const at = posInSeq.get(parent);
      if (at !== undefined) {
        const offset = (childCount.get(parent) ?? 0) + 1;
        childCount.set(parent, offset);
        seq.splice(at + offset, 0, id);
        // Update posInSeq for the inserted child and every element that shifted right.
        for (let k = at + offset; k < seq.length; k++) posInSeq.set(seq[k], k);
      } else seq.push(id);
    }
    const pinned = [...this.#pinned].filter((id) => this.#modules.has(id));
    return [...seq, ...pinned];
  }

  // Realize the effective order on the map by chaining moveLayer from the top down, anchoring
  // the whole overlay group just beneath the top sentinel so it stays above the base style.
  #applyOrder(order = this.#effectiveOrder()): void {
    if (this.#disposed) return;
    // Band insertion already yields the default order, so a restack only matters once a saved
    // order or a pin makes the desired order differ from the plain band sequence.
    if (!this.#explicitOrder.length && !this.#pinned.size) return;
    const desired: string[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const module = this.#modules.get(id);
      if (!module) continue;
      for (const layerId of module.layerIds) {
        if (!seen.has(layerId) && this.#ctx.map.getLayer(layerId)) {
          seen.add(layerId);
          desired.push(layerId);
        }
      }
    }
    const anchor = sentinelId('overlay-top');
    let cursor = this.#ctx.map.getLayer(anchor) ? anchor : undefined;
    for (let k = desired.length - 1; k >= 0; k--) {
      this.#ctx.map.moveLayer(desired[k], cursor);
      cursor = desired[k];
    }
  }

  // Broadcast a theme change to every overlay that recolors itself, so each slice owns
  // the theming of its own layers instead of the widget reaching into them by id.
  applyTheme(paint: MapThemePaint): void {
    if (this.#disposed) return;
    this.#lastPaint = paint;
    for (const module of this.#modules.values()) {
      module.applyTheme?.(this.#ctx, paint);
    }
  }

  // The entry point for a full base-style swap: it re-adds every overlay onto the fresh style.
  // No in-app action swaps the base style yet (theme changes recolor in place), so this is forward
  // scaffolding for that path, exercised by tests and ready for when a style swap lands.
  async reattachAll(): Promise<void> {
    if (this.#disposed) return;
    // A base-style swap wipes the sentinel layers too, so restore them before
    // re-adding overlays or every beforeId would point at a missing layer.
    installSentinels(this.#ctx.map);
    for (const [id, module] of this.#modules) {
      const state = this.#state.get(id) ?? DEFAULT_OVERLAY_STATE;
      // The swap recreated this overlay's sources empty, so invalidate its change-detection cache
      // before re-adding, so the next sync repopulates rather than early-returning as unchanged.
      module.reset?.();
      try {
        await (module.reattach ?? module.add).call(module, this.#ctx);
      } catch (error) {
        try {
          module.remove(this.#ctx);
        } catch {
          // Keep the reattach failure as the useful error when partial cleanup is also unavailable.
        }
        throw error;
      }
      if (this.#disposed) {
        // The reattach completed after disposal and may have recreated map resources after the
        // first cleanup pass. Remove them now, then stop the batch without touching map state.
        try {
          module.remove(this.#ctx);
        } catch {
          // The map may already have removed its style. Cleanup remains best effort here.
        }
        return;
      }
      this.#syncVisibility(module, state, true);
      this.#syncOpacity(module, state);
      this.#syncChildOpacities(module.id);
      if (this.#lastPaint) module.applyTheme?.(this.#ctx, this.#lastPaint);
    }
    this.#applyOrder();
  }

  // The layer list for the panel, top of the map first, so the panel's top row is the top layer.
  layers(): LayerListItem[] {
    // Synchronize every module, including unlisted safety overlays, before projecting panel rows.
    this.#refreshAvailability();
    return this.#effectiveOrder()
      .reverse()
      .flatMap((id) => {
        const module = this.#modules.get(id);
        if (!module) return [];
        if (module.listed === false) return [];
        const state = this.#state.get(id) ?? DEFAULT_OVERLAY_STATE;
        const available = this.#availability.get(id) ?? true;
        return [
          {
            id,
            title: module.title,
            description: module.description,
            visible: available && state.visible,
            opacity: state.opacity,
            supportsOpacity: module.supportsOpacity,
            pinned: this.#pinned.has(id),
            band: module.band,
            parent: module.parent,
            group: module.group,
            category: module.category,
            region: module.region,
            available,
            unavailableHint: module.unavailableHint,
            manageable: module.manageable,
            chart: module.chart,
            cellSizeControl: module.cellSizeControl,
            cellSizeScale: state.cellSizeScale,
            labelSizeControl: module.labelSizeControl,
            labelSizeScale: state.labelSizeScale,
            depthDisplayControl: module.depthDisplayControl,
            displayDepth: state.displayDepth,
            cellPortrayal: state.cellPortrayal,
            bathymetryColorScheme: state.bathymetryColorScheme,
            chartCoverage: module.chartCoverage,
            facetPresets: module.facetPresets,
          },
        ];
      });
  }
}

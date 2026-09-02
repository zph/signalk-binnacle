# Visual components framework

## Status

Proposed architecture for a later incremental refactor. This document does not change the current
instrument plugin API or permit an external provider to execute code in Binnacle.

## Purpose

Binnacle has display surfaces that are independently useful, configurable, and sometimes placeable
in more than one location. Instruments are the reference model: they have stable identities, a
catalog, data bindings, a presentation, selection state, and more than one host.

The visual components framework generalizes that model. A visual component is a user-meaningful
display surface, such as an instrument, strip, chart overlay, chart control, panel, or focused
full-screen view. It gives Binnacle a safe, typed way to compose displays from registered parts.

The goal is composable display surfaces, not a plugin wrapper around every Svelte component.

## Goals

- Give each independently selectable display surface a stable identity and a typed definition.
- Render a visual through each compatible host using a small, host-specific contract.
- Persist placement, visibility, size, and component settings separately from its renderer.
- Register built-in visuals through the same registry as future trusted local packs.
- Retain a safe, declarative path for Signal K-provided visuals.
- Support desktop, iPad, and phone layouts as first-class configurations.
- Keep Binnacle in control of themes, units, freshness, accessibility, safety language, and cleanup.
- Derive Command K and display-management entries from registry metadata where appropriate.

## Non-goals

- Shared primitives such as buttons, SlideOver, panel headers, fields, and small icon renderers are
  not visual components.
- A Signal K server or remote plugin cannot supply JavaScript, CSS, HTML, or arbitrary Svelte code.
- The framework does not absorb feature business logic. Domain controllers stay feature-owned.
- A visual is not automatically valid in every host. It declares its compatible hosts.
- The first phase does not replace the current binnacleInstruments resource contract.
- The framework does not add global service singletons. App.svelte constructs and injects services.

## Vocabulary

### Visual component

A user-meaningful display surface that is independently selectable, placeable, configurable, or
lifecycle-bearing. Examples are a depth instrument, the navigation strip, an anchor-watch strip,
a weather readout, a chart legend, and a route-planning panel.

### Definition

Static metadata for a visual: identity, label, category, compatible hosts, defaults, capabilities,
and either a trusted renderer or a bounded declarative presentation.

### Model

Typed reactive data and callbacks a renderer receives. A feature controller or adapter creates the
model from injected services. A renderer does not construct services or read application singletons.

### Host

A display region that renders compatible visual instances. The initial host set is:

| Host id | Purpose |
| --- | --- |
| dock | Resizable dock grid, initially the Instruments dock |
| chart-overlay | Freely positioned visual over the chart |
| strip | Operational readout strip |
| panel | Slide-over feature surface |
| full-screen | Focused, full-app display surface |

Future hosts, such as a second-display canvas, must be explicit host types rather than variants of
an existing host.

### Instance

A placed copy of a definition. The definition is the catalog entry. An instance carries host,
placement, visibility, and settings. A definition can have multiple instances only if it declares
that it supports them.

## Architecture

    App.svelte
      constructs and injects application services
              |
              v
    Visual registry <--- built-in visual packs
              |       <--- future trusted local packs
              |       <--- declarative Signal K visual packs
              v
    Visual layout and settings stores
              |
              v
    Visual hosts: dock, chart overlay, strip, panel, full screen
              |
              v
    Trusted Svelte renderer or Binnacle-owned declarative renderer

This is a display-composition layer. It does not own Signal K subscriptions, routing, navigation
calculations, chart-map lifecycle, or feature policy. The feature that owns those concerns supplies
a narrow model factory to the visual definition.

## Feature-Sliced Design placement

The generic framework belongs in entities/visual-component, because it is a cross-feature domain
concept and cannot import feature implementations. Its public API contains types, registry
construction, placement codecs, and host compatibility helpers.

Hosts belong in widgets/visual-hosts when they compose features or own a display region. Features
own their definitions, renderer adapters, controllers, and settings UI. The application composition
root creates the registry, registers packs, and injects dependencies.

    src/entities/visual-component/
      visual-types.ts
      visual-registry.svelte.ts
      visual-layout.ts

    src/widgets/visual-hosts/
      DockVisualHost.svelte
      ChartOverlayVisualHost.svelte
      StripVisualHost.svelte

    src/features/instruments/
      instrument-visual-pack.ts
      instrument-visual-adapter.svelte.ts

## Core contracts

The exact names can evolve, but these boundaries are required:

    type VisualHostId = 'dock' | 'chart-overlay' | 'strip' | 'panel' | 'full-screen';

    interface VisualDefinition<Model = unknown, Settings = unknown> {
      id: string;
      label: string;
      description: string;
      category: VisualCategory;
      hosts: readonly VisualHostId[];
      defaultPlacement?: Partial<Record<VisualHostId, VisualPlacement>>;
      multiplicity: 'single' | 'multiple';
      capabilities: {
        configurable: boolean;
        resizable: boolean;
        movable: boolean;
      };
      command?: VisualCommand;
      createModel: (services: VisualServices, instance: VisualInstance<Settings>) => Model;
      renderer: TrustedVisualRenderer<Model>;
    }

    interface VisualInstance<Settings = unknown> {
      id: string;
      definitionId: string;
      host: VisualHostId;
      placement: VisualPlacement;
      settings: Settings;
    }

    interface VisualRegistry {
      readonly definitions: readonly VisualDefinition[];
      readonly issues: readonly string[];
      register(pack: VisualPack, scope?: string): () => void;
      replaceScope(scope: string, packs: readonly VisualPack[]): void;
      resolve(id: string): VisualDefinition | undefined;
    }

TrustedVisualRenderer is a local Svelte component type. It is never serialized or accepted from a
server response. VisualServices is a narrow typed facade, not a grab bag. Each feature adapter
receives only the services it needs, and mutable dependencies such as auth tokens are getters.

## Host contracts

Hosts have separate typed contexts rather than a universal prop bag.

- dock supplies tile size, expanded state, activation, and dock-specific accessible labels.
- chart-overlay supplies normalized box placement, edit state, snapping, and z-order.
- strip supplies available edge, compactness, safe-area clearance, and overflow priority.
- panel supplies open and close lifecycle, focus restoration, and SlideOver anatomy.
- full-screen supplies entry, exit, and focused-display behavior.

A definition provides a host-specific renderer adapter when semantics differ. A wind instrument can
use its current tile renderer in the dock and chart-overlay hosts, while a navigation strip only
registers for the strip host. Renderers must not receive meaningless map, panel, or resize props.

Hosts own compatibility, responsive layout, drag and resize behavior, keyboard movement, focus,
error boundaries, safe areas, and teardown. Renderers own only their local display and interactions.
They do not globally position themselves, persist layout, or install global listeners.

## Registration and validation

A versioned visual pack groups related definitions under a stable id. Built-in visual packs use the
same registration mechanism, in principle, as the current Binnacle instrument plugin.

The registry rejects and reports unsupported API versions, malformed or duplicate pack ids,
duplicate definition ids, definitions with no host, defaults targeting an unsupported host, and
invalid trusted renderers or model factories.

Registration order is deterministic. Scope replacement preserves the last accepted external catalog
when a subsequent resource response is invalid, matching the existing instrument-provider behavior.
The initial implementation may wrap the current instrument registry internally. It must not require
a destructive catalog rewrite before the first migrated visual works.

## Trusted and external visuals

### Trusted local packs

Binnacle source and any future explicitly trusted local packages can register a renderer and typed
model factory. They follow the normal theme, accessibility, lifecycle, and dependency-boundary rules.

### Signal K declarative packs

Signal K resources register JSON-safe data definitions only. Binnacle maps them to a bounded set of
its own renderers and bindings. The existing binnacleInstruments contract is the first and only
external visual contract until another versioned schema is approved.

External packs cannot provide executable code, stylesheet or script URLs, HTML, raw SVG markup,
remote fonts, raw colors, CSS class names, or arbitrary subscription policy. Binnacle owns units,
freshness, zones, alarms, accessible names, no-data behavior, and theme adaptation.

## Placement, persistence, and migration

Layouts are device-scoped by default. They belong to the helm or display, not a profile, unless a
later requirement explicitly establishes profile-scoped layouts.

    interface VisualLayoutDocument {
      version: 1;
      instances: VisualInstance[];
    }

Placement is a discriminated union by host. A chart-overlay stores normalized x, y, width, and
height. A dock stores tile size and ordering. A strip stores ordering, visibility, and overflow
priority. A freely positioned chart visual never stores raw viewport pixels.

Migration must:

1. Read existing instrument screen layout, tile layout, dock width, open state, and selection values.
2. Convert compatible instrument placements to visual instances without changing their stable ids.
3. Preserve unknown ids long enough for dynamic discovery or an external provider to resolve them.
4. Remove invalid or duplicate placements predictably, keeping the first valid placement.
5. Retain a tested rollback reader until the migration has proven stable in a release.

Persisted data stays in SI. Renderers format only at the display edge through existing shared helpers.

## Configuration and discovery

Definitions declare configuration capability and use a Binnacle-owned settings codec. Feature-owned
settings UI remains feature-owned. The framework may provide discovery and direct opening, but does
not generate unsafe generic forms from external JSON.

Every configurable or independently adjustable visual has a root-level Command K entry that opens
it directly, even if it is hidden or currently on another display. Registry metadata should also
support add, focus, remove, and reset-layout actions, and should explain unavailable external
visuals.

## Accessibility, safety, and themes

Every host and renderer supports pointer, keyboard, and touch input. Desktop, iPad, and phone are
required operating modes.

A definition provides concise metadata. The renderer provides a complete spoken state, including
label, value, unit, freshness, and zone or alarm state when relevant. Missing data is never zero.

Visuals use design-system tokens and shared primitives. They render in day, dusk, and night-red.
Night-red remains red on true black with no blue pixels, and warnings and alarms remain distinct.
Navigation-related visuals remain advisory and cannot weaken that language through registry metadata
or external manifests.

## Error handling and lifecycle

Every lazy or dynamically resolved renderer is wrapped in ErrorBoundary. Failure of one renderer
must not take down the chart, app shell, or other instances. The host shows a concise recoverable
state with a relevant action, such as retry, settings, or remove.

On removal, host change, or replacement, adapters clean up subscriptions, map layers, DOM observers,
timers, and event handlers. Map-backed visuals require stable source and layer ids, idempotent
installation, theme application, and reset paths. Browser hooks and protocols are registered once
at startup, never by an instance.

## Incremental migration

### Phase 1: foundation

Create the entities-level types, reactive registry, validation, scopes, compatibility helpers, and
layout codecs. Add registry and persistence tests. Do not add an external resource type.

### Phase 2: instruments

Make instruments the reference adapter. Retain their renderers, manifest parser, subscriptions,
trend integration, selection, and external binnacleInstruments behavior. Render them through
generic dock and chart-overlay hosts while preserving current layout and interactions.

### Phase 3: placement and management

Move instrument placement and tile layout into the versioned visual layout document. Build generic
add, move, resize, remove, reset, and focus behavior. Keep Instrument-specific Customize UI until
the generic equivalent reaches parity.

### Phase 4: low-risk built-ins

Migrate self-contained strips and overlays, such as navigation, anchor-watch, weather readouts, and
legends. Each migration needs a concrete benefit such as placement, display selection, or shared
lifecycle handling.

### Phase 5: panels and full-screen visuals

Register panels and focused views only where registry-driven opening, Command K discovery, lazy
loading, or multi-display routing reduces duplication. Panels retain their feature-owned controller
and required SlideOver anatomy.

### Phase 6: future external declarative visuals

Specify a separate versioned resource contract per external category. Each requires a bounded
renderer set, validation, accessibility behavior, data and freshness policy, failure mode, and theme
rules before implementation.

## Completion criteria for every migrated visual

- Existing layout and settings migrate without visible loss or reset.
- The visual works in every declared host and rejects unsupported hosts.
- Desktop, iPad, and phone behavior is designed and tested, including keyboard, touch targets, and
  safe-area behavior.
- Day, dusk, and night-red render correctly.
- Current Signal K subscription, stale-data, units, zones, and safety behavior is retained.
- A Command K route exists when the visual is configurable or independently adjustable.
- Tests cover the adapter, registry, layout migration, and teardown.
- Browser tests cover representative host interaction and placement where applicable.
- npm run verify passes. Run npm run verify:browser when shell, layout, chart lifecycle, or browser
  behavior changes.

## Open design decisions

- Whether the first registry wraps the current instrument registry or replaces it behind a
  compatibility facade.
- The smallest Svelte component type abstraction that keeps host-specific renderer props checked.
- Whether layout is one device-wide document or separate host documents in a shared envelope.
- How a future second display identifies its device scope and synchronizes explicitly chosen settings.
- Which current strips are independently configurable visuals versus fixed safety or app-shell chrome.
- Whether trusted local packs are ever supported beyond source-controlled Binnacle code. That needs a
  separate security and distribution decision.

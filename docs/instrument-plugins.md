# Instrument plugins

Binnacle exposes one versioned registration contract for every instrument. Its baked-in static
catalog and its discovered battery, engine, tank, solar, and cabin instruments register through
that contract. A separate Signal K plugin can register an instrument pack through the same
registry by providing a JSON-safe manifest through the Signal K Resources API.

This design keeps Binnacle usable on a stock Signal K server. If no instrument provider is
installed, all built-in instruments continue to work. If a provider is unavailable or returns an
invalid manifest, Binnacle keeps the last accepted external catalog and explains the state in
Customize.

## Provider contract

Use the custom resource type `binnacleInstruments`. During startup, a Signal K plugin registers a
read-only resource provider with `app.registerResourceProvider(...)`. Binnacle discovers providers
at:

```text
/signalk/v2/api/resources/binnacleInstruments/_providers
```

It then reads and validates the aggregated collection at:

```text
/signalk/v2/api/resources/binnacleInstruments
```

The collection is a keyed object. Each value is one API version 1 plugin manifest:

```json
{
  "apiVersion": 1,
  "id": "engine-pack",
  "name": "Engine room instruments",
  "instruments": [
    {
      "id": "boost",
      "label": "Boost pressure",
      "abbr": "BOOST",
      "description": "Main engine intake pressure.",
      "sensorGloss": "No boost pressure",
      "category": "propulsion",
      "path": "propulsion.main.intakeManifoldPressure",
      "format": "pressure",
      "presentation": "numeric",
      "visualization": "spark",
      "trend": true,
      "aggregate": "average"
    }
  ]
}
```

Plugin ids use lowercase letters, digits, dots, underscores, and hyphens. Instrument ids use
lowercase letters, digits, underscores, and hyphens. Binnacle persists an external instrument as
`plugin:<plugin-id>:<instrument-id>`, so two providers cannot accidentally claim the same local
instrument id.

## Instrument fields

Every instrument requires `id`, `label`, `description`, `category`, `path`, and `format`.

- `category`: `navigation`, `wind`, `depth`, `weather`, `electrical`, `propulsion`, `tanks`, or
  `cabin`.
- `format`: `number`, `speed`, `bearing`, `angle`, `depth`, `temperature`, `pressure`, `ratio`,
  `duration`, `rpm`, `rate-of-turn`, `voltage`, `current`, `volume`, or `power`.
- `presentation`: `numeric` by default, or `compass`, `heel`, or `wind`. A compass requires the
  `bearing` format. A heel instrument requires the `angle` format. A wind instrument requires the
  `speed` format and an `anglePath`.
- `precision`: zero through three decimal places. The default is one.
- `unit`: a display unit for `number`. Standard formats choose their marine or user-preferred unit
  at the display edge while Signal K values remain in SI.
- `zonesPath`: the path whose Signal K `meta.zones` and notification state color the instrument.
  It defaults to `path`.
- `anglePath`: the Signal K angle path for a wind presentation.
- `referenceLabel`: a short reference such as `APP`, `TRUE`, or `M`.
- `visualization`: `spark`, `battery`, or `rot` for a numeric presentation.
- `trend`: `true` to make a supported numeric format available in Data trends.
- `aggregate`: `average`, `max`, or `last`. The default is `average`.
- `abbr` and `sensorGloss`: optional compact and no-data labels.

Provider-controlled text, ids, paths, array sizes, presentation combinations, and API versions are
validated before registration. Version 1 manifests are declarative. Binnacle does not download or
execute JavaScript from instrument providers.

## Design guidance

An instrument pack supplies marine meaning and Signal K bindings. Binnacle owns the visual shell,
interaction, subscriptions, units, freshness, zone colors, accessibility, and theme adaptation. Keep
the provider contract small and declarative:

- Publish values in Signal K SI units. Select the semantic `format` that describes the value instead
  of formatting a string in advance or choosing a display unit.
- Point `path`, `anglePath`, and `zonesPath` at real Signal K paths. Do not copy a value into a
  provider-specific namespace merely to make a tile. Binnacle subscribes only while the instrument
  is selected and uses the source metadata from the path it displays.
- Prefer one instrument per operational question. A label such as `Boost pressure` is clearer than
  a generic `Engine value`. Use `abbr` for the arm's-length scan name and `description` to explain
  what the reading means to a navigator.
- Treat no data, stale data, warning, and alarm as separate states. Do not replace a missing value
  with zero, invent a client-only stale timeout, or encode warning colors into labels. Binnacle uses
  the server's `meta.timeout`, `meta.zones`, and notification state when available.
- Choose the least elaborate presentation that communicates the value. Use `numeric` for most
  readings, `compass` only for a bearing, `heel` only for signed heel, and `wind` only when speed and
  a compatible relative angle are both meaningful.
- Keep instruments read-only unless a future versioned API explicitly defines a control contract.
  A displayed value is advisory and must not imply that Binnacle can command the source device.
- Avoid brand colors, fixed backgrounds, remote fonts, remote images, HTML, CSS, and executable
  code. Binnacle must render every instrument in day, dusk, and night-red themes, with no blue or
  bright stray pixels in night-red.

Binnacle also owns the standard tile interactions. Activating a face expands it to the full app
surface, activating the expanded face restores the grid, and the right-click Inspect action opens
metadata and trend details. Instrument manifests do not declare, replace, or style these
controls.

The visible label, value, unit, freshness, and zone must also form a complete spoken description.
Plugin authors provide concise labels and descriptions; Binnacle constructs the accessible name and
keeps the whole tile touch-sized. A plugin should be useful at the narrow dock width before relying
on horizontal expansion.

## Composite instruments

API version 1 intentionally accepts only the standard single-reading presentations. Composite
instruments need a named, versioned data shape because their signals, fallback rules, alarm source,
and accessible summary must remain consistent. They are not expressed as provider HTML or remote
JavaScript.

Binnacle's built-in wind rose is the reference composite. It registers through the same local
instrument registry as every other built-in instrument and combines:

- apparent wind speed and relative angle;
- true wind speed and relative angle, with the ground-referenced fallback identified;
- true heading, then magnetic heading, then COG as the documented last-resort compass reference;
- speed over ground in the lower-left corner; and
- resolved depth in the lower-right corner, colored from the depth path's Signal K zones and
  notification state.

Its visual hierarchy follows the installed Skip wind rose: a rotating compass card inside a strong
annular dial, 10-degree ticks, 30-degree labels, red port and green starboard sectors, orange
apparent-wind and yellow true-wind tapered pointers, a fixed heading window, a quiet hull outline,
crosshair lines, and paired AWS and TWS readouts. Dusk brightens those roles. Night-red remaps both
lateral sectors and wind pointers into distinct red and amber brightness levels so it never emits
green or blue. Future composite presentations should document the same five things before a new API
version accepts them: required paths, fallback order, freshness rule, zone owner, and an equivalent
spoken summary.

## Minimal Signal K plugin

All four resource methods are present because the Signal K provider interface requires them. The
write methods reject because an instrument manifest is owned by the plugin package.

```js
const manifest = {
  apiVersion: 1,
  id: 'engine-pack',
  name: 'Engine room instruments',
  instruments: [
    {
      id: 'boost',
      label: 'Boost pressure',
      description: 'Main engine intake pressure.',
      category: 'propulsion',
      path: 'propulsion.main.intakeManifoldPressure',
      format: 'pressure',
      visualization: 'spark',
      trend: true,
    },
  ],
}

module.exports = (app) => {
  const plugin = {
    id: 'engine-pack',
    name: 'Engine instrument pack',
    start() {
      app.registerResourceProvider({
        type: 'binnacleInstruments',
        methods: {
          listResources: () => Promise.resolve({ [manifest.id]: manifest }),
          getResource: (id) =>
            id === manifest.id
              ? Promise.resolve(manifest)
              : Promise.reject(new Error('Instrument pack not found')),
          setResource: () => Promise.reject(new Error('Read only')),
          deleteResource: () => Promise.reject(new Error('Read only')),
        },
      })
    },
    stop() {},
    schema: () => ({ type: 'object', properties: {} }),
  }
  return plugin
}
```

Once the plugin is installed and enabled, open Instruments, choose Customize, and select Rescan.
External instruments appear in the same category lists and use the same selection, subscription,
zone, detail, and trend paths as Binnacle's baked-in instruments.

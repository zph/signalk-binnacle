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

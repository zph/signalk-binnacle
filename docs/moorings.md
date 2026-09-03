# Moorings

Binnacle shows fixed mooring and warping facilities from NOAA ENC Direct in U.S. waters. It merges
the Overview, General, Coastal, Approach, Harbour, and Berthing compilation scales, preferring the
most detailed record when scale bands place a facility at the same charted position. Open
**Moorings** from the main menu or Command K, pan to the harbor to review, and zoom to level 11 or
closer. The panel lists only facilities inside the visible chart area. Search covers the name,
category, ENC cell, NOAA information, observed vessel, and AIS clue. A row or chart marker selects
the same mooring, and **Locate** centers the chart on it.

The charted position is authoritative source data, but the occupancy clue is only an observation.
Binnacle reports three states:

- **Likely occupied** means a nearby AIS target has accumulated strong slow-speed, dwell, bounded
  movement, swing-center, or reported moored evidence.
- **Possible occupancy** means some evidence exists, but it is not strong enough for the higher
  classification.
- **Unknown** means AIS cannot establish occupancy. It does not mean vacant.

Many recreational boats do not transmit AIS. Class B reports also usually omit navigational status.
Binnacle therefore uses position, median speed, dwell time, and movement geometry, and does not rely
on the reported moored state.

## Data paths

The Binnacle Signal K plugin proxies and briefly caches the NOAA query. A standalone Binnacle build
falls back to NOAA ENC Direct in the browser when the companion route is absent.

For the area around the boat, Binnacle uses AIS targets already present in Signal K. It does not
open another AIS connection for that case.

Remote-area review is owned by the extended `signalk-aisstream` plugin. A dedicated second upstream
WebSocket follows the chart viewport after it remains stable for 1.5 seconds. The plugin retains a
bounded 30-minute history, shares one destination request among clients, rate-limits subscription
replacements, and stops requesting the destination area after five minutes without a request.
Remote targets appear on the chart independently of the Moorings layer and also inform mooring
occupancy when that layer is active. The AISStream key stays in that plugin and is never sent to
Binnacle.

If the extension is absent or disconnected, NOAA mooring positions and onboard Signal K AIS remain
available. The panel explains the degraded state, and unobserved facilities stay unknown.

Sources:

- [NOAA ENC Direct services](https://nauticalcharts.noaa.gov/learn/encdirect/)
- [AISStream WebSocket documentation](https://aisstream.io/documentation)

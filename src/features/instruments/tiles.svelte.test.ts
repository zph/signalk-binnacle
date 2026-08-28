import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ZoneState } from '$shared/signalk';
import AttitudeTile from './AttitudeTile.svelte';
import CompassTile from './CompassTile.svelte';
import HeelTile from './HeelTile.svelte';
import NumericTile from './NumericTile.svelte';
import TideTile from './TideTile.svelte';
import type { TileReading } from './tile-catalog';
import WindRoseTile from './WindRoseTile.svelte';
import WindTile from './WindTile.svelte';

// SSR-only suite (node environment, no DOM). Assertions are substring checks on the rendered body.

function numericBody(props: {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
}): string {
  return render(NumericTile, { props }).body;
}

function windBody(props: {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
}): string {
  return render(WindTile, { props }).body;
}

const LIVE: TileReading = { state: 'live', value: '7.4', unit: 'kn', siValue: 3.8 };
const STALE: TileReading = { state: 'stale', value: '6.1', unit: 'kn', siValue: 3.1 };
const NEVER: TileReading = { state: 'never', value: '---', unit: '' };
const PLACEHOLDER_READING: TileReading = { state: 'placeholder', value: '---', unit: 'kn' };

const GLOSS = 'No speed sensor';
const LABEL = 'SOG';
const normal: ZoneState = 'normal';

describe('NumericTile', () => {
  it('shows value and unit for a live reading', () => {
    const html = numericBody({ label: LABEL, reading: LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('7.4');
    expect(html).toContain('<span class="title-unit">(kn)</span>');
    expect(html).toContain('tile--numeric');
    expect(html).toContain('value--short');
    expect(html).toContain('class="tile-footer"');
    expect(html).toContain('aria-label="SOG, 7.4 kn. Expand instrument"');
  });

  it('steps down the fill size for longer formatted values', () => {
    const medium = numericBody({
      label: LABEL,
      reading: { ...LIVE, value: '12.3' },
      zone: normal,
      sensorGloss: GLOSS,
    });
    const long = numericBody({
      label: LABEL,
      reading: { ...LIVE, value: '123.45' },
      zone: normal,
      sensorGloss: GLOSS,
    });
    const wide = numericBody({
      label: LABEL,
      reading: { ...LIVE, value: '123456789' },
      zone: normal,
      sensorGloss: GLOSS,
    });
    const extraWide = numericBody({
      label: LABEL,
      reading: { ...LIVE, value: '1234567890' },
      zone: normal,
      sensorGloss: GLOSS,
    });
    expect(medium).toContain('value--medium');
    expect(long).toContain('value--long');
    expect(wide).toContain('value--wide');
    expect(extraWide).toContain('value--extra-wide');
  });

  it('renders sensorGloss and hides value span when state is never', () => {
    const html = numericBody({ label: LABEL, reading: NEVER, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain(GLOSS);
    // The value string ('---') must not appear in a num span; the sensorGloss path is taken.
    // We verify the num wrapper is absent by checking no num class attribute is present.
    expect(html).not.toMatch(/class="[^"]*\bnum\b/);
  });

  it('renders value as-is for placeholder state', () => {
    const html = numericBody({
      label: LABEL,
      reading: PLACEHOLDER_READING,
      zone: normal,
      sensorGloss: GLOSS,
    });
    expect(html).toContain('---');
    expect(html).not.toContain(GLOSS);
  });

  it('adds tile--stale class when state is stale', () => {
    const html = numericBody({ label: LABEL, reading: STALE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--stale');
    expect(html).toContain('Stale');
    expect(html).toContain('stale. Expand instrument');
  });

  it('shows the retained value age while stale', () => {
    const html = render(NumericTile, {
      props: {
        label: LABEL,
        reading: STALE,
        zone: normal,
        sensorGloss: GLOSS,
        staleAgeText: '19 s ago',
      },
    }).body;
    expect(html).toContain('19 s ago');
  });

  it('keeps data-quality text while warning and alarm remain color-only', () => {
    const staleWarning = numericBody({
      label: LABEL,
      reading: STALE,
      zone: 'warning',
      sensorGloss: GLOSS,
    });
    expect(staleWarning).toContain('>Stale<');
    expect(staleWarning).not.toContain('>Warning<');
    const staleAlarm = numericBody({
      label: LABEL,
      reading: STALE,
      zone: 'alarm',
      sensorGloss: GLOSS,
    });
    expect(staleAlarm).toContain('>Stale<');
    expect(staleAlarm).not.toContain('>Alarm<');
  });

  it('adds tile--alarm class for alarm zone', () => {
    const html = numericBody({
      label: LABEL,
      reading: LIVE,
      zone: 'alarm',
      sensorGloss: GLOSS,
    });
    expect(html).toContain('tile--alarm');
    expect(html).not.toContain('>Alarm<');
    expect(html).toContain('alarm. Expand instrument');
    expect(html).not.toContain('tile--warning');
  });

  it('adds tile--warning class for warning zone', () => {
    const html = numericBody({
      label: LABEL,
      reading: LIVE,
      zone: 'warning',
      sensorGloss: GLOSS,
    });
    expect(html).toContain('tile--warning');
    expect(html).not.toContain('>Warning<');
    expect(html).not.toContain('tile--alarm');
  });

  it('carries no aria-live attribute', () => {
    const html = numericBody({ label: LABEL, reading: LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).not.toContain('aria-live');
  });

  it('appends referenceLabel to the caps-label when present', () => {
    const reading: TileReading = { ...LIVE, referenceLabel: 'M' };
    const html = numericBody({ label: 'HDG', reading, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('HDG (M)');
  });

  it('carries tile--empty class when state is never', () => {
    const html = numericBody({ label: LABEL, reading: NEVER, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--empty');
  });

  it('renders abbr in .abbr span after the label', () => {
    const html = render(NumericTile, {
      props: { label: 'Speed', reading: LIVE, zone: normal, sensorGloss: GLOSS, abbr: 'SOG' },
    }).body;
    expect(html).toContain('<span class="abbr">SOG</span>');
  });
});

describe('TideTile', () => {
  it('renders the selected station, prediction curve, and full-screen settings action', () => {
    const html = render(TideTile, {
      props: {
        label: 'Tides',
        sensorGloss: 'No tide prediction',
        reading: {
          state: 'live',
          value: '1.2',
          unit: 'm',
          tideUnitsMode: 'metric',
          tideNowMs: 1500,
          tideDepthMeters: 4,
          tide: {
            station: { id: 'T1', name: 'Test Harbor', latitude: 1, longitude: 2 },
            distanceMeters: 1000,
            events: [
              { timeMs: 1000, heightMeters: 0.2, kind: 'low' },
              { timeMs: 2000, heightMeters: 1.2, kind: 'high' },
            ],
          },
        },
        expanded: true,
        actionLabel: 'Collapse instrument',
        onOpen: () => {},
        onSettings: () => {},
      },
    }).body;

    expect(html).toContain('Test Harbor');
    expect(html).toMatch(/class="curve\s/);
    expect(html).toMatch(/class="depth-curve\s/);
    expect(html).toContain('Tide station settings');
    expect(html).toContain('aria-label="Collapse instrument: Tides, 1.2 m"');
  });
});

describe('WindTile', () => {
  const WIND_LIVE: TileReading = {
    state: 'live',
    value: '12.3',
    unit: 'kn',
    siValue: 6.3,
    angleRad: Math.PI / 2,
  };

  it('renders an SVG with a needle rotated by angleRad', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    // deg = angleRad * 180 / Math.PI. Compute the same way the component does.
    const expectedDeg = (WIND_LIVE.angleRad ?? 0) * (180 / Math.PI);
    expect(html).toContain(`rotate(${expectedDeg} 50 50)`);
  });

  it('marks the SVG as aria-hidden', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('aria-hidden="true"');
  });

  it('shows speed value and unit in the readable line', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('12.3');
    expect(html).toContain('kn');
    expect(html).toContain('AWS, 12.3 kn. Expand instrument');
  });

  it('shows formatted angle text beside speed', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    // angleRad = π/2 → starboard 90°, formatSignedAngleOr → 'S 90'
    expect(html).toContain('S 90');
  });

  it('renders sensorGloss and no SVG when state is never', () => {
    const neverWind: TileReading = { state: 'never', value: '---', unit: '' };
    const html = windBody({ label: 'AWS', reading: neverWind, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain(GLOSS);
    expect(html).not.toContain('<svg');
  });

  it('adds tile--stale class when state is stale', () => {
    const staleWind: TileReading = {
      state: 'stale',
      value: '8.0',
      unit: 'kn',
      siValue: 4.1,
      angleRad: 0,
    };
    const html = windBody({ label: 'AWS', reading: staleWind, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--stale');
  });

  it('adds tile--alarm class for alarm zone', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: 'alarm', sensorGloss: GLOSS });
    expect(html).toContain('tile--alarm');
  });

  it('carries no aria-live attribute', () => {
    const html = windBody({ label: 'AWS', reading: WIND_LIVE, zone: normal, sensorGloss: GLOSS });
    expect(html).not.toContain('aria-live');
  });

  it('carries tile--empty class when state is never', () => {
    const neverWind: TileReading = { state: 'never', value: '---', unit: '' };
    const html = windBody({ label: 'AWS', reading: neverWind, zone: normal, sensorGloss: GLOSS });
    expect(html).toContain('tile--empty');
  });

  it('omits needle when angleRad is undefined (speed live but angle absent)', () => {
    const speedOnly: TileReading = { state: 'live', value: '10.0', unit: 'kn', siValue: 5.1 };
    const html = windBody({ label: 'AWS', reading: speedOnly, zone: normal, sensorGloss: GLOSS });
    expect(html).not.toContain('class="needle"');
  });
});

describe('purpose-built instrument faces', () => {
  it('renders a rotating compass card', () => {
    const html = render(CompassTile, {
      props: {
        label: 'Heading compass',
        reading: { ...LIVE, value: '090°', unit: '', siValue: Math.PI / 2 },
        zone: normal,
        sensorGloss: 'No heading data',
      },
    }).body;
    expect(html).toContain('rotate(-90');
    expect(html).toContain('Heading compass, 090°');
  });

  it('renders heel on the correct side of the dial', () => {
    const html = render(HeelTile, {
      props: {
        label: 'Heel',
        reading: {
          state: 'live',
          value: '12.0',
          unit: '°',
          siValue: -Math.PI / 15,
          rollRad: -Math.PI / 15,
          secondary: 'Port',
        },
        zone: normal,
        sensorGloss: 'No heel data',
      },
    }).body;
    expect(html).toContain('rotate(-12');
    expect(html).toContain('Port');
  });

  it('renders a pitch-and-roll horizon', () => {
    const html = render(AttitudeTile, {
      props: {
        label: 'Pitch and roll',
        reading: {
          state: 'live',
          value: '5.7° / -11.5°',
          unit: '',
          pitchRad: 0.1,
          rollRad: -0.2,
        },
        zone: normal,
        sensorGloss: 'No attitude data',
      },
    }).body;
    expect(html).toContain('class="attitude ');
    expect(html).toMatch(/P\s+5\.7°/);
    expect(html).toMatch(/R\s+11\.5°/);
  });

  it('centers the heading over the compass and keeps other readouts outside it', () => {
    const reading: TileReading = {
      state: 'live',
      value: '12.0',
      unit: 'kn',
      siValue: 6.2,
      windRose: {
        apparent: {
          state: 'live',
          value: '12.0',
          unit: 'kn',
          siValue: 6.2,
          angleRad: -0.5,
          angleEpoch: 1000,
        },
        trueWind: {
          state: 'live',
          value: '10.0',
          unit: 'kn',
          siValue: 5.1,
          angleRad: 0.7,
          angleEpoch: 1000,
        },
        heading: {
          state: 'live',
          value: '057°',
          unit: '',
          siValue: 1,
          referenceLabel: 'M',
        },
        speedOverGround: { state: 'live', value: '6.4', unit: 'kn', siValue: 3.3 },
        depth: { state: 'live', value: '1.8', unit: 'm', siValue: 1.8 },
      },
    };
    const html = render(WindRoseTile, {
      props: {
        label: 'Wind rose',
        reading,
        zone: 'alarm',
        depthZone: 'warning',
        sensorGloss: 'No wind data',
      },
    }).body;
    expect(html).toContain('SOG');
    expect(html).toContain('6.4');
    expect(html).toContain('DEPTH');
    expect(html).toContain('1.8');
    expect(html).toContain('rose-readouts--top');
    expect(html).toContain('rose-readouts--bottom');
    expect(html).toContain('class="heading-pill ');
    expect(html).toContain('class="heading-digits ');
    expect(html).toContain('class="heading-degree ');
    expect(html).toContain('>057<');
    expect(html).toContain('>°<');
    expect(html).not.toContain('>HDG<');
    expect(html).not.toContain('>(M)<');
    expect(html.indexOf('heading-pill')).toBeGreaterThan(html.lastIndexOf('</svg>'));
    expect(html).toContain('rose-readout--depth-warning');
    expect(html.match(/rose-readout--alarm/g)).toHaveLength(2);
    expect(html).not.toContain('>AWA<');
    expect(html).not.toContain('>TWA<');
    expect(html).toContain('(kn)');
    expect(html).toContain('(m)');
    expect(html).not.toContain('>Warning<');
    expect(html).not.toContain('>Wind rose<');
    expect(html).toContain('Speed over ground 6.4 kn');
    expect(html).toContain('Heading 057°');
    expect(html).toContain('class="fixed-dial ');
    expect(html).toContain('class="wind-sector-fill ');
    expect(html).toContain('M186 186 A444 444 0 0 1 814 186 L500 500 Z');
    expect(html.indexOf('wind-sector-fill')).toBeLessThan(html.indexOf('fixed-dial'));
    expect(html).toContain('class="wind-sectors"');
    expect(html).toContain('data-reference="true"');
    expect(html).toContain('rotate(40.107');
    expect(html).toContain('class="port-sector ');
    expect(html).toContain('class="starboard-sector ');
    expect(html).toContain('M163 367 A362 362 0 0 1 373 161');
    expect(html).toContain('M627 161 A362 362 0 0 1 837 367');
    expect(html).toContain('class="port-sector-line ');
    expect(html).toContain('class="starboard-sector-line ');
    expect(html).toContain('M186 186 L500 500');
    expect(html).toContain('M814 186 L500 500');
    expect(html).toContain('class="apparent-pointer ');
    expect(html).toContain('class="true-pointer ');
    expect(html).toContain('rotate(-57.295');

    const staleHtml = render(WindRoseTile, {
      props: {
        label: 'Wind rose',
        reading: { ...reading, state: 'stale' },
        zone: normal,
        depthZone: normal,
        sensorGloss: 'No wind data',
        staleAgeText: '19 s ago',
      },
    }).body;
    expect(staleHtml).not.toContain('tile--stale');
    expect(staleHtml).toContain('>Stale<');
    expect(staleHtml).toContain('19 s ago');
    expect(staleHtml).toContain('Wind data stale');

    const windRose = reading.windRose;
    if (!windRose) throw new Error('Test reading must include a wind rose');
    const apparentOnlyHtml = render(WindRoseTile, {
      props: {
        label: 'Wind rose',
        reading: {
          ...reading,
          windRose: {
            ...windRose,
            trueWind: { state: 'never', value: '---', unit: '' },
          },
        },
        zone: normal,
        depthZone: normal,
        sensorGloss: 'No wind data',
      },
    }).body;
    expect(apparentOnlyHtml).toContain('data-reference="apparent"');
    expect(apparentOnlyHtml).toContain('rotate(-28.647');

    const alarmHtml = render(WindRoseTile, {
      props: {
        label: 'Wind rose',
        reading,
        zone: normal,
        depthZone: 'alarm',
        sensorGloss: 'No wind data',
      },
    }).body;
    expect(alarmHtml).toContain('rose-readout--depth-alarm');
    expect(alarmHtml).not.toContain('rose-readout--alarm');
    expect(alarmHtml).not.toContain('>Alarm<');
  });
});

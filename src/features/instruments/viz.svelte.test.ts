import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BatteryBar from './BatteryBar.svelte';
import RotNeedle from './RotNeedle.svelte';
import Sparkline from './Sparkline.svelte';
import { createTileHistory } from './tile-history.svelte';
import VerticalHistoryTile from './VerticalHistoryTile.svelte';

// SSR-only suite (node environment, no DOM). Assertions are substring checks on the rendered body.

describe('Sparkline', () => {
  it('renders nothing with fewer than 2 points', () => {
    expect(render(Sparkline, { props: { points: [] } }).body).not.toContain('<svg');
    expect(render(Sparkline, { props: { points: [5] } }).body).not.toContain('<svg');
  });

  it('renders a polyline for 3 points', () => {
    const html = render(Sparkline, { props: { points: [0, 5, 10] } }).body;
    expect(html).toContain('<polyline');
    // x spreads 0, 50, 100; y inverts so min (0) is 22 and max (10) is 2.
    expect(html).toContain('points="0,22 50,12 100,2"');
  });

  it('draws a flat midline when all points are equal', () => {
    const html = render(Sparkline, { props: { points: [5, 5, 5] } }).body;
    expect(html).toContain('points="0,12 50,12 100,12"');
  });

  it('is aria-hidden', () => {
    const html = render(Sparkline, { props: { points: [1, 2, 3] } }).body;
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('BatteryBar', () => {
  it('scales the fill width with the fraction', () => {
    const html = render(BatteryBar, { props: { fraction: 0.5 } }).body;
    // 30 units of travel * 0.5 = 15.
    expect(html).toContain('class="fill');
    expect(html).toContain('width="15"');
  });

  it('clamps the fill width for a fraction above 1', () => {
    const html = render(BatteryBar, { props: { fraction: 2 } }).body;
    expect(html).toContain('width="30"');
  });

  it('renders no fill rect for an undefined fraction', () => {
    const html = render(BatteryBar, { props: { fraction: undefined } }).body;
    expect(html).not.toContain('class="fill');
    // The outline (body plus terminal nub) still renders.
    expect(html).toContain('<svg');
  });

  it('tints the fill by state through the severity utilities', () => {
    const warn = render(BatteryBar, { props: { fraction: 0.5, state: 'warning' } }).body;
    expect(warn).toContain('sev-warning');
    const alarm = render(BatteryBar, { props: { fraction: 0.5, state: 'alarm' } }).body;
    expect(alarm).toContain('sev-danger');
    const normal = render(BatteryBar, { props: { fraction: 0.5 } }).body;
    expect(normal).not.toContain('sev-warning');
    expect(normal).not.toContain('sev-danger');
  });

  it('is aria-hidden', () => {
    const html = render(BatteryBar, { props: { fraction: 0.5 } }).body;
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('RotNeedle', () => {
  it('clamps the needle rotation at the full-scale rate', () => {
    // 1 rad/s is far above 30 deg/min, so the needle pins to +60 (starboard).
    const html = render(RotNeedle, { props: { radPerSec: 1, maxDegPerMin: 30 } }).body;
    expect(html).toContain('rotate(60 20 20)');
  });

  it('rotates counter-clockwise for a port turn', () => {
    const html = render(RotNeedle, { props: { radPerSec: -1, maxDegPerMin: 30 } }).body;
    expect(html).toContain('rotate(-60 20 20)');
  });

  it('omits the needle when the value is undefined', () => {
    const html = render(RotNeedle, { props: { radPerSec: undefined } }).body;
    expect(html).not.toContain('class="needle"');
    // The dial (arc plus center tick) still renders.
    expect(html).toContain('<svg');
  });

  it('is aria-hidden', () => {
    const html = render(RotNeedle, { props: { radPerSec: 0.001 } }).body;
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('VerticalHistoryTile', () => {
  it('renders a newest-first ten-minute TWS squiggle with scale labels', () => {
    const html = render(VerticalHistoryTile, {
      props: {
        label: 'True wind speed history',
        reading: { state: 'live', value: '6.0', unit: 'kn', siValue: 3.0867 },
        zone: 'normal',
        sensorGloss: 'No true wind data',
        abbr: 'TWS',
        mode: 'speed',
        points: [
          { atMs: 595_000, value: 2 },
          { atMs: 600_000, value: 3.0867 },
        ],
        maximumPoints: [
          { atMs: 595_000, value: 3 },
          { atMs: 600_000, value: 4 },
        ],
        nowMs: 600_000,
      },
    }).body;

    expect(html).toContain('tile--vertical-history');
    expect(html).toContain('class="squiggle ');
    expect(html).toContain('squiggle--maximum');
    expect(html).toContain('>Now<');
    expect(html).toContain('>-5m<');
    expect(html).toContain('>-10m<');
    expect(html).toContain('>TWS<');
    expect(html).toContain('>3.9<');
    expect(html).toContain('>6.0<');
    expect(html).toContain('>3.9 kn Δ<');
    expect(html).toContain('Historical range 3.9 kn.');
    expect(html).toContain('Ten-minute vertical history, newest at top.');
  });

  it('renders a measured port-to-starboard TWA scale', () => {
    const html = render(VerticalHistoryTile, {
      props: {
        label: 'True wind angle history',
        reading: { state: 'live', value: 'P 45', unit: '°', siValue: -Math.PI / 4 },
        zone: 'normal',
        sensorGloss: 'No true wind angle data',
        abbr: 'TWA',
        mode: 'angle',
        points: [
          { atMs: 595_000, value: -Math.PI / 3 },
          { atMs: 600_000, value: -Math.PI / 4 },
        ],
        nowMs: 600_000,
      },
    }).body;

    expect(html).toContain('>P 60<');
    expect(html).toContain('>P 45<');
    expect(html).toContain('>15° Δ<');
    expect(html).toContain('Historical range 15°.');
    expect(html).toContain('center-reference');
    expect(html).toContain('class="caps-label abbr');
    expect(html).not.toContain('>True wind angle history</span>');
  });
});

describe('createTileHistory', () => {
  it('updates a live five-second average and maximum on every sample', () => {
    const hist = createTileHistory();
    hist.sampleBucket('tws-history', 4, 10_000, true);
    hist.sampleBucket('tws-history', 8, 11_000, true);
    hist.sampleBucket('tws-history', 6, 15_000, true);

    expect(hist.timedSeries('tws-history')).toEqual([
      { atMs: 10_000, value: 6 },
      { atMs: 15_000, value: 6 },
    ]);
    expect(hist.timedSeries('tws-history:maximum')).toEqual([
      { atMs: 10_000, value: 8 },
      { atMs: 15_000, value: 6 },
    ]);
  });

  it('trims the buffer to the capacity, oldest first', () => {
    const hist = createTileHistory();
    for (let i = 0; i < 125; i++) hist.sample('a', i, i * 5000);
    const series = hist.series('a');
    expect(series.length).toBe(121);
    expect(series[0]).toBe(4);
    expect(series[120]).toBe(124);
  });

  it('retains timestamps for time-scaled vertical traces', () => {
    const hist = createTileHistory();
    hist.sample('a', 10, 1000);
    hist.sample('a', 20, 6000);
    expect(hist.timedSeries('a')).toEqual([
      { atMs: 1000, value: 10 },
      { atMs: 6000, value: 20 },
    ]);
  });

  it('drops a sample taken sooner than the min spacing', () => {
    const hist = createTileHistory();
    hist.sample('a', 10, 0);
    hist.sample('a', 20, 4999); // dropped: under 5000 ms since the last accepted sample
    hist.sample('a', 30, 5000); // accepted: exactly at the spacing boundary
    expect(hist.series('a')).toEqual([10, 30]);
  });

  it('skips undefined values', () => {
    const hist = createTileHistory();
    hist.sample('a', undefined, 0);
    expect(hist.series('a')).toEqual([]);
  });

  it('prunes buffers for ids no longer live', () => {
    const hist = createTileHistory();
    hist.sample('a', 1, 0);
    hist.sample('b', 2, 0);
    hist.prune(new Set(['a']));
    expect(hist.series('a')).toEqual([1]);
    expect(hist.series('b')).toEqual([]);
  });

  it('honors custom capacity and spacing options', () => {
    const hist = createTileHistory({ capacity: 3, minSpacingMs: 1000 });
    hist.sample('a', 1, 0);
    hist.sample('a', 2, 1000);
    hist.sample('a', 3, 2000);
    hist.sample('a', 4, 3000);
    expect(hist.series('a')).toEqual([2, 3, 4]);
  });

  it('merges sorted historical points without overwriting an in-flight live sample', () => {
    const hist = createTileHistory({ capacity: 4 });
    hist.sample('a', 40, 4000);
    hist.merge('a', [
      { atMs: 3000, value: 30 },
      { atMs: 1000, value: 10 },
      { atMs: 4000, value: -1 },
      { atMs: Number.NaN, value: 20 },
    ]);
    expect(hist.timedSeries('a')).toEqual([
      { atMs: 1000, value: 10 },
      { atMs: 3000, value: 30 },
      { atMs: 4000, value: 40 },
    ]);
  });

  it('lets a polled finalized aggregate replace its matching live bucket', () => {
    const hist = createTileHistory();
    hist.sampleBucket('a', 4, 5_000);
    hist.merge('a', [{ atMs: 5_000, value: 3.5 }], true);
    expect(hist.timedSeries('a')).toEqual([{ atMs: 5_000, value: 3.5 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { createPositionRenderGate, POSITION_RENDER_DEADBAND_METERS } from './position-render-gate';

describe('position render gate', () => {
  it('suppresses fresh position objects and accumulated scatter below the display deadband', () => {
    const gate = createPositionRenderGate();
    const position = { latitude: 38, longitude: -122 };

    expect(gate.shouldRender(position)).toBe(true);
    for (let index = 0; index < 1_000; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      expect(
        gate.shouldRender({
          latitude: position.latitude + sign * 0.000_001,
          longitude: position.longitude - sign * 0.000_001,
        }),
      ).toBe(false);
    }
  });

  it('accepts meaningful motion, a changed layout variant, and a reset', () => {
    const gate = createPositionRenderGate();
    const position = { latitude: 38, longitude: -122 };

    expect(gate.shouldRender(position, { variant: 'compact' })).toBe(true);
    expect(
      gate.shouldRender(
        { latitude: position.latitude + 0.001, longitude: position.longitude },
        { variant: 'compact' },
      ),
    ).toBe(true);
    expect(
      gate.shouldRender(
        { latitude: position.latitude + 0.001, longitude: position.longitude },
        { variant: 'expanded' },
      ),
    ).toBe(true);

    gate.reset();
    expect(gate.shouldRender(position, { variant: 'compact' })).toBe(true);
  });

  it('delivers a trailing moved position after a bounded interval', () => {
    let now = 0;
    const gate = createPositionRenderGate(() => now);
    const position = { latitude: 38, longitude: -122 };

    expect(gate.shouldRender(position, { maxIntervalMs: 5_000 })).toBe(true);
    const smallMove = {
      latitude: position.latitude + POSITION_RENDER_DEADBAND_METERS / 222_000,
      longitude: position.longitude,
    };
    now = 4_999;
    expect(gate.shouldRender(smallMove, { maxIntervalMs: 5_000 })).toBe(false);
    now = 5_000;
    expect(gate.shouldRender(smallMove, { maxIntervalMs: 5_000 })).toBe(true);

    // Time alone does not repaint an unchanged coordinate.
    now = 20_000;
    expect(gate.shouldRender({ ...smallMove }, { maxIntervalMs: 5_000 })).toBe(false);
  });

  it('does not treat sub-deadband sensor jitter as trailing motion', () => {
    let now = 0;
    const gate = createPositionRenderGate(() => now);
    const position = { latitude: 38, longitude: -122 };
    const options = {
      minDistanceMeters: 50,
      minTrailingDistanceMeters: POSITION_RENDER_DEADBAND_METERS,
      maxIntervalMs: 5_000,
    };

    expect(gate.shouldRender(position, options)).toBe(true);
    now = 60_000;
    expect(
      gate.shouldRender(
        { latitude: position.latitude + 0.000_001, longitude: position.longitude },
        options,
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '$shared/settings';
import {
  applyCollisionPolicy,
  COLLISION_POLICY_PRESETS,
  collisionBandDisabled,
  collisionPolicyId,
} from './collision-policy';

describe('collision policies', () => {
  it('recognizes each built-in threshold envelope', () => {
    for (const preset of COLLISION_POLICY_PRESETS) {
      expect(collisionPolicyId(preset.thresholds)).toBe(preset.id);
    }
  });

  it('treats an edited envelope as custom', () => {
    expect(collisionPolicyId({ ...DEFAULT_THRESHOLDS, warningTcpaSeconds: 33 * 60 })).toBe(
      'custom',
    );
  });

  it('applies a preset without changing the shallow-water threshold', () => {
    const applied = applyCollisionPolicy(
      { ...DEFAULT_THRESHOLDS, shallowDepthMeters: 4.2 },
      'narrow',
    );
    expect(collisionPolicyId(applied)).toBe('narrow');
    expect(applied.shallowDepthMeters).toBe(4.2);
  });

  it('disables a band when either of its values is zero', () => {
    expect(collisionBandDisabled({ ...DEFAULT_THRESHOLDS, dangerCpaMeters: 0 }, 'danger')).toBe(
      true,
    );
    expect(collisionBandDisabled({ ...DEFAULT_THRESHOLDS, warningTcpaSeconds: 0 }, 'warning')).toBe(
      true,
    );
    expect(collisionBandDisabled(DEFAULT_THRESHOLDS, 'danger')).toBe(false);
  });
});

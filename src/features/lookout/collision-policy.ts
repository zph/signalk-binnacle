import { nauticalMilesToMeters } from '$shared/lib';
import type { Thresholds } from '$shared/settings';

export const COLLISION_POLICY_PRESET_IDS = ['narrow', 'coastal', 'offshore'] as const;
export type CollisionPolicyPresetId = (typeof COLLISION_POLICY_PRESET_IDS)[number];
export type CollisionPolicyId = CollisionPolicyPresetId | 'custom';

export type CollisionThresholds = Pick<
  Thresholds,
  'dangerCpaMeters' | 'dangerTcpaSeconds' | 'warningCpaMeters' | 'warningTcpaSeconds'
>;

export interface CollisionPolicyPreset {
  id: CollisionPolicyPresetId;
  label: string;
  description: string;
  thresholds: CollisionThresholds;
}

const minutes = (value: number): number => value * 60;
const nauticalMiles = (value: number): number => Math.round(nauticalMilesToMeters(value));

export const COLLISION_POLICY_PRESETS: readonly CollisionPolicyPreset[] = [
  {
    id: 'narrow',
    label: 'Narrow waters',
    description: 'Closer and shorter alerts for constrained bays and channels.',
    thresholds: {
      dangerCpaMeters: nauticalMiles(0.2),
      dangerTcpaSeconds: minutes(5),
      warningCpaMeters: nauticalMiles(0.5),
      warningTcpaSeconds: minutes(10),
    },
  },
  {
    id: 'coastal',
    label: 'Coastal',
    description: 'Balanced notice for ordinary coastal passages.',
    thresholds: {
      dangerCpaMeters: nauticalMiles(0.5),
      dangerTcpaSeconds: minutes(10),
      warningCpaMeters: nauticalMiles(1),
      warningTcpaSeconds: minutes(20),
    },
  },
  {
    id: 'offshore',
    label: 'Offshore',
    description: 'Earlier and wider alerts where there is room to maneuver.',
    thresholds: {
      dangerCpaMeters: nauticalMiles(1),
      dangerTcpaSeconds: minutes(15),
      warningCpaMeters: nauticalMiles(2),
      warningTcpaSeconds: minutes(30),
    },
  },
] as const;

function sameThresholds(left: CollisionThresholds, right: CollisionThresholds): boolean {
  return (
    left.dangerCpaMeters === right.dangerCpaMeters &&
    left.dangerTcpaSeconds === right.dangerTcpaSeconds &&
    left.warningCpaMeters === right.warningCpaMeters &&
    left.warningTcpaSeconds === right.warningTcpaSeconds
  );
}

export function collisionPolicyId(thresholds: CollisionThresholds): CollisionPolicyId {
  return (
    COLLISION_POLICY_PRESETS.find((preset) => sameThresholds(thresholds, preset.thresholds))?.id ??
    'custom'
  );
}

export function applyCollisionPolicy(
  current: Thresholds,
  presetId: CollisionPolicyPresetId,
): Thresholds {
  const preset = COLLISION_POLICY_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return current;
  return { ...current, ...preset.thresholds };
}

export function collisionBandDisabled(
  thresholds: CollisionThresholds,
  band: 'danger' | 'warning',
): boolean {
  return thresholds[`${band}CpaMeters`] === 0 || thresholds[`${band}TcpaSeconds`] === 0;
}

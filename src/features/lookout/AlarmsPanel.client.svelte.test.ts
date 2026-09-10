import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import {
  type AlarmLocation,
  DEFAULT_THRESHOLDS,
  type PersistedValue,
  type Thresholds,
} from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';
import { applyCollisionPolicy } from './collision-policy';

const mounted: Array<() => void> = [];

function mountPanel(
  initialThresholds: Thresholds = { ...DEFAULT_THRESHOLDS, dangerCpaMeters: 1000 },
) {
  const set = vi.fn();
  const alarmLocationSet = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AlarmsPanel, {
      target,
      props: {
        auth: { writeBlocked: false } as AuthController,
        connectionPhase: 'open',
        notifications: { list: () => [] } as unknown as NotificationsStore,
        thresholds: {
          value: initialThresholds,
          set,
        } as unknown as PersistedValue<Thresholds>,
        alarmLocation: {
          value: 'bottom',
          set: alarmLocationSet,
        } as unknown as PersistedValue<AlarmLocation>,
        units: { mode: 'metric' } as UnitsStore,
        alarmSilenced: false,
        alarmSilenceRemainingSeconds: 0,
        onSilenceAllAlarms: () => {},
        onClearAlarmSilence: () => {},
        collisionMuted: false,
        collisionMuteRemainingMin: undefined,
        onToggleCollisionMute: () => {},
        arrivalMuted: false,
        onToggleArrivalMute: () => {},
        activeProfileName: 'Bay sailing',
        onClose: () => {},
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (text: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!found) throw new Error(`no button labeled ${text}`);
    return found;
  };
  const click = (text: string): void => {
    button(text).click();
    flushSync();
  };
  // The thresholds live inside a Disclosure that ships collapsed.
  click('Adjust collision alarm sensitivity');
  return { set, alarmLocationSet, target, button, click };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('AlarmsPanel collision policies', () => {
  it('offers the three presets and applies one without changing shallow water', () => {
    const panel = mountPanel();
    expect(panel.target.textContent).toContain('Narrow waters');
    expect(panel.target.textContent).toContain('Coastal');
    expect(panel.target.textContent).toContain('Offshore');
    expect(panel.target.textContent).toContain('the Bay sailing profile');
    expect(panel.target.textContent).toContain('Custom:');

    panel.click('Narrow waters');
    expect(panel.set).toHaveBeenCalledWith(applyCollisionPolicy(DEFAULT_THRESHOLDS, 'narrow'));
  });

  it('labels either zero value as a disabled alarm band', () => {
    const panel = mountPanel({
      ...DEFAULT_THRESHOLDS,
      dangerCpaMeters: 0,
      warningTcpaSeconds: 0,
    });
    const text = panel.target.textContent?.replaceAll(/\s+/g, ' ') ?? '';
    expect(text).toContain('Danger Disabled');
    expect(text).toContain('Warning Disabled');
  });
});

describe('AlarmsPanel alarm location', () => {
  it('offers top, center, and bottom choices', () => {
    const panel = mountPanel();
    const group = panel.target.querySelector('[role="group"][aria-label="Alarm location"]');

    expect(group?.textContent?.replaceAll(/\s+/g, ' ').trim()).toBe('Top Center Bottom');
    expect(panel.button('Bottom').getAttribute('aria-pressed')).toBe('true');
    panel.click('Center');
    expect(panel.alarmLocationSet).toHaveBeenCalledWith('center');
  });
});

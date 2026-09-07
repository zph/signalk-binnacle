import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import AlarmButton from './AlarmButton.svelte';

function button(grade: 'alert' | 'alarm' | undefined, count = 0): string {
  return render(AlarmButton, { props: { grade, count, onOpen: vi.fn() } }).body;
}

describe('AlarmButton', () => {
  it('is always an alarm-menu action and reports its active count', () => {
    const html = button(undefined, 2);
    expect(html).toContain('aria-label="Open alarms, 2 active notifications"');
    expect(html).toContain('title="Open alarms"');
  });

  it('renders distinct alert and alarm pulse grades', () => {
    expect(button('alert')).toContain('alarm-button--alert');
    expect(button('alarm')).toContain('alarm-button--alarm');
    expect(button(undefined)).not.toContain('alarm-button--alert');
    expect(button(undefined)).not.toContain('alarm-button--alarm');
  });
});

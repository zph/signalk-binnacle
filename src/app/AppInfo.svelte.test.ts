import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AppInfo from './AppInfo.svelte';

describe('AppInfo', () => {
  it('renders a compact labeled information trigger', () => {
    const body = render(AppInfo, { props: { version: '2.4.6' } }).body;

    expect(body).toContain('aria-label="About Binnacle Custom"');
    expect(body).toContain('aria-expanded="false"');
  });
});

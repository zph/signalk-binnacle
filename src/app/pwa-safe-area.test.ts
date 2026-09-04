import { describe, expect, it } from 'vitest';
import INDEX_HTML from '../../index.html?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
import APP from './App.svelte?raw';
import STATUS_STRIP from './StatusStrip.svelte?raw';

describe('installed PWA system-bar clearance', () => {
  it('allows the viewport to expose browser safe-area insets', () => {
    expect(INDEX_HTML).toContain('viewport-fit=cover');
  });

  it('locks mobile browser scale so the chartplotter layout remains reachable', () => {
    expect(INDEX_HTML).toContain('maximum-scale=1.0');
    expect(INDEX_HTML).toContain('user-scalable=no');
  });

  it('keeps a fallback clearance for installed touch PWAs', () => {
    expect(TOKENS_CSS).toContain('--system-bar-clearance: env(safe-area-inset-bottom, 0px)');
    expect(TOKENS_CSS).toMatch(
      /@media \(display-mode: standalone\) and \(pointer: coarse\)[\s\S]*--system-bar-clearance:\s*max\(/,
    );
    expect(TOKENS_CSS).toContain('var(--system-bar-fallback)');
  });

  it('applies bottom and landscape-edge clearance to the status strip', () => {
    expect(STATUS_STRIP).toContain(
      'padding-block-end: calc(var(--space-2) + var(--system-bar-clearance))',
    );
    expect(STATUS_STRIP).toContain('env(safe-area-inset-left, 0px)');
    expect(STATUS_STRIP).toContain('env(safe-area-inset-right, 0px)');
  });

  it('keeps ready updates and chart controls on the iPad rails around centered MOB', () => {
    expect(APP).toContain('class:helm-primary-actions--update-ready={updateReady}');
    expect(APP).toContain('aria-label="Install ready update"');
    expect(APP).toContain('class="helm-actions-start"');
    expect(APP).toContain('class="helm-actions-end"');
    expect(APP).toContain('--helm-action-size: calc(2 * var(--control-size))');
  });

  it('keeps center on vessel as the final fixed action on the right rail', () => {
    const rightRail = APP.slice(
      APP.indexOf('<div class="helm-actions-end">'),
      APP.indexOf('</div>', APP.indexOf('<div class="helm-actions-end">')),
    );
    expect(rightRail).toContain('aria-label="Center on vessel"');
    expect(rightRail.indexOf('aria-label="Center on vessel"')).toBeGreaterThan(
      rightRail.indexOf("aria-label={actionDialOpen ? 'Close supermenu' : 'Open supermenu'}"),
    );
    expect(APP).toMatch(/id: 'center',[\s\S]*?fixedToBar: true/);
  });

  it('removes the redundant browser full-screen control in an installed PWA', () => {
    expect(APP).toContain("createMediaQuery('(display-mode: standalone)')");
    expect(APP).toContain('{#if !installedPwa}');
  });
});

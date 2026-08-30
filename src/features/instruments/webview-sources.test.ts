import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import {
  cleanWebviewUrl,
  discoverWebviewInstruments,
  parseLauncherApps,
  parseLauncherLinks,
  webviewTileDef,
} from './webview-sources';

afterEach(() => vi.unstubAllGlobals());

const VALID_APPS_BODY = {
  apps: [
    {
      name: 'signalk-tides',
      title: 'Tides and currents',
      description: 'Tide predictions from the server.',
      version: '1.0.0',
      url: '/signalk-tides/',
      icons: [],
      pinned: true,
    },
    { name: 'broken app', title: '' },
    { name: 'bad-scheme', title: 'Bad', url: 'javascript:alert(1)' },
    { name: 'external-app', title: 'External', url: 'https://example.com/tide' },
  ],
};

describe('cleanWebviewUrl', () => {
  it('accepts same-origin absolute paths and http/https URLs', () => {
    expect(cleanWebviewUrl('/signalk-tides/')).toBe('/signalk-tides/');
    expect(cleanWebviewUrl('http://example.com/tide')).toBe('http://example.com/tide');
  });

  it('rejects dangerous and malformed sources', () => {
    expect(cleanWebviewUrl('javascript:alert(1)')).toBeUndefined();
    expect(cleanWebviewUrl('data:text/html,<b>x</b>')).toBeUndefined();
    expect(cleanWebviewUrl('//evil.com')).toBeUndefined();
    expect(cleanWebviewUrl('ftp://x')).toBeUndefined();
    expect(cleanWebviewUrl('/')).toBeUndefined();
    expect(cleanWebviewUrl('x'.repeat(2049))).toBeUndefined();
    expect(cleanWebviewUrl('bad\u0000url')).toBeUndefined();
    expect(cleanWebviewUrl(42)).toBeUndefined();
  });
});

describe('parseLauncherApps', () => {
  it('keeps valid installed apps and skips malformed entries', () => {
    const sources = parseLauncherApps({ apps: VALID_APPS_BODY.apps });
    // Only the one same-origin installed app survives; an external-URL app is not an installed
    // webapp mount, and blank or dangerous entries are rejected.
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: 'signalk-tides',
      title: 'Tides and currents',
      url: '/signalk-tides/',
      kind: 'app',
    });
  });

  it('returns nothing for a malformed top-level body', () => {
    expect(parseLauncherApps('nope')).toEqual([]);
    expect(parseLauncherApps({ apps: 'nope' })).toEqual([]);
  });
});

describe('parseLauncherLinks', () => {
  it('keeps valid curated links and skips malformed entries', () => {
    const sources = parseLauncherLinks({
      links: [
        {
          id: 'wx',
          title: 'Weather',
          url: 'https://weather.example.com',
          description: 'Briefings',
        },
        { id: 'bad', title: 'Bad', url: 'data:text/plain,x' },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('link');
    expect(sources[0].description).toBe('Briefings');
  });

  it('accepts a same-origin curated path and still marks it a link', () => {
    const sources = parseLauncherLinks({
      links: [{ id: 'local', title: 'Local', url: '/pages/tide.html' }],
    });
    expect(sources).toEqual([
      { id: 'local', title: 'Local', url: '/pages/tide.html', kind: 'link' },
    ]);
  });
});

describe('webviewTileDef', () => {
  it('builds a pathless apps-category web view tile with a live synthetic reading', () => {
    const def = webviewTileDef({
      id: 'signalk-tides',
      title: 'Tides and currents',
      description: 'Predictions',
      url: '/signalk-tides/',
      kind: 'app',
    });
    expect(def.id).toBe('webview:app:signalk-tides');
    expect(def.category).toBe('apps');
    expect(def.kind).toBe('webview');
    expect(def.paths).toEqual([]);
    expect(def.zonesPath).toBe('');
    expect(def.webview).toEqual({ url: '/signalk-tides/', kind: 'app' });
    const reading = def.read(undefined as never);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('WEB');
    expect(reading.secondary).toBe('Web view');
  });
});

describe('discoverWebviewInstruments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports absent when the launcher is not installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );
    const result = await discoverWebviewInstruments('http://localhost:3000', undefined);
    expect(result.state).toBe('absent');
    expect(result.tiles).toHaveLength(0);
  });

  it('merges, dedupes, and caps validated apps and links into tiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/apps')) {
          return jsonResponse(200, {
            apps: [
              { name: 'signalk-tides', title: 'Tides', url: '/signalk-tides/' },
              { name: 'signalk-freeboard', title: 'Charts', url: '/signalk-skia/' },
            ],
          });
        }
        return jsonResponse(200, {
          pinned: [],
          links: [
            { id: 'wx', title: 'Weather', url: 'http://wx.example.com' },
            // Same source id as an installed app: deduped, apps first.
            { id: 'signalk-tides', title: 'Tides link', url: 'http://tides.example.com' },
          ],
        });
      }),
    );
    const result = await discoverWebviewInstruments('http://localhost:3000', undefined);
    expect(result.state).toBe('ready');
    expect(result.tiles.map((tile) => tile.id)).toEqual([
      'webview:app:signalk-tides',
      'webview:app:signalk-freeboard',
      'webview:link:wx',
    ]);
  });

  it('reports failed when either endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/config') ? jsonResponse(500, {}) : jsonResponse(200, { apps: [] }),
      ),
    );
    const result = await discoverWebviewInstruments('http://localhost:3000', undefined);
    expect(result.state).toBe('failed');
    expect(result.tiles).toEqual([]);
  });

  it('rejects malformed entries and counts them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/apps')
          ? jsonResponse(200, { apps: [{ name: 'ok-app', title: 'Ok', url: '/ok-app/' }, 'junk'] })
          : jsonResponse(200, { pinned: [], links: [] }),
      ),
    );
    const result = await discoverWebviewInstruments('http://localhost:3000', undefined);
    expect(result.state).toBe('ready');
    expect(result.tiles).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import {
  dropAnchorOnServer,
  raiseServerAnchor,
  setServerAnchorPosition,
  setServerZone,
} from './anchor-client';

const BASE = 'https://boat.example';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anchor server client', () => {
  it('drops the anchor with a position and watch zone', async () => {
    const mock = stubFetch({ ok: true });
    await expect(
      dropAnchorOnServer(
        BASE,
        'tok',
        { latitude: 1, longitude: 2 },
        { type: 'circle', radius: 45 },
      ),
    ).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/plugins/hoekens-anchor-alarm/dropAnchor`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      position: { latitude: 1, longitude: 2 },
      zone: { type: 'circle', radius: 45 },
    });
    expectBearerAuth(init, 'tok');
  });

  it('sets a zone and raises through the plugin endpoints', async () => {
    const mock = stubFetch({ ok: true });
    await setServerZone(BASE, undefined, { type: 'circle', radius: 60 });
    await raiseServerAnchor(BASE, undefined);
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      `${BASE}/plugins/hoekens-anchor-alarm/setZone`,
      `${BASE}/plugins/hoekens-anchor-alarm/raiseAnchor`,
    ]);
  });

  it('moves the anchor through the plugin endpoint', async () => {
    const mock = stubFetch({ ok: true });
    await expect(
      setServerAnchorPosition(
        BASE,
        'tok',
        { latitude: 1.5, longitude: -2.5 },
        { type: 'sector', radius: 60, startAngle: 300, endAngle: 60 },
      ),
    ).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/plugins/hoekens-anchor-alarm/setZone`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      position: { latitude: 1.5, longitude: -2.5 },
      zone: { type: 'sector', radius: 60, startAngle: 300, endAngle: 60 },
    });
  });

  it('returns false on a non-OK status (the missing-plugin detection path)', async () => {
    stubFetch({ ok: false });
    await expect(
      dropAnchorOnServer(
        BASE,
        undefined,
        { latitude: 1, longitude: 2 },
        { type: 'circle', radius: 50 },
      ),
    ).resolves.toBe(false);
  });

  it('returns false on a network failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(raiseServerAnchor(BASE, undefined)).resolves.toBe(false);
  });
});

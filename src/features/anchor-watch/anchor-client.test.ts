import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import {
  dropAnchorOnServer,
  raiseServerAnchor,
  setServerAnchorPosition,
  setServerRadius,
} from './anchor-client';

const BASE = 'https://boat.example';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anchor server client', () => {
  it('drops the anchor with the radius in the body', async () => {
    const mock = stubFetch({ ok: true });
    await expect(dropAnchorOnServer(BASE, 'tok', 45)).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/plugins/anchoralarm/dropAnchor`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ radius: 45 });
    expectBearerAuth(init, 'tok');
  });

  it('sets the radius and raises through the plugin endpoints', async () => {
    const mock = stubFetch({ ok: true });
    await setServerRadius(BASE, undefined, 60);
    await raiseServerAnchor(BASE, undefined);
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      `${BASE}/plugins/anchoralarm/setRadius`,
      `${BASE}/plugins/anchoralarm/raiseAnchor`,
    ]);
  });

  it('moves the anchor through the plugin endpoint', async () => {
    const mock = stubFetch({ ok: true });
    await expect(
      setServerAnchorPosition(BASE, 'tok', { latitude: 1.5, longitude: -2.5 }),
    ).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/plugins/anchoralarm/setAnchorPosition`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      position: { latitude: 1.5, longitude: -2.5 },
    });
  });

  it('returns false on a non-OK status (the missing-plugin detection path)', async () => {
    stubFetch({ ok: false });
    await expect(dropAnchorOnServer(BASE, undefined, 50)).resolves.toBe(false);
  });

  it('returns false on a network failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(raiseServerAnchor(BASE, undefined)).resolves.toBe(false);
  });
});

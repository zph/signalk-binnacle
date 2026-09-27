import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import { createPluginAnchorCommands } from './anchor-commands';

afterEach(() => vi.unstubAllGlobals());

describe('plugin anchor commands', () => {
  it('maps every command to the plugin API and reads the current token each time', async () => {
    const fetch = stubFetch({ ok: true });
    let token = 'first';
    const commands = createPluginAnchorCommands('https://boat.example', () => token);

    await expect(
      commands.drop({ latitude: 1, longitude: 2 }, { type: 'circle', radius: 45 }),
    ).resolves.toBe(true);
    token = 'second';
    await expect(commands.setZone({ type: 'circle', radius: 60 })).resolves.toBe(true);
    await expect(
      commands.setZone({ type: 'circle', radius: 60 }, { latitude: 1.5, longitude: -2.5 }),
    ).resolves.toBe(true);
    await expect(commands.raise()).resolves.toBe(true);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://boat.example/plugins/hoekens-anchor-alarm/dropAnchor',
      'https://boat.example/plugins/hoekens-anchor-alarm/setZone',
      'https://boat.example/plugins/hoekens-anchor-alarm/setZone',
      'https://boat.example/plugins/hoekens-anchor-alarm/raiseAnchor',
    ]);
    expectBearerAuth(fetch.mock.calls[0][1], 'first');
    for (const [, init] of fetch.mock.calls.slice(1)) expectBearerAuth(init, 'second');
  });

  it('does not report success when the plugin is absent', async () => {
    stubFetch({ ok: false });
    const commands = createPluginAnchorCommands('https://boat.example', () => undefined);
    await expect(
      commands.drop({ latitude: 1, longitude: 2 }, { type: 'circle', radius: 45 }),
    ).resolves.toBe(false);
  });
});

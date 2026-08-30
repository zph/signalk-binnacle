import { cleanBoundedText, hasControlCharacters, isRecord } from '$shared/lib';
import { fetchAuthedJsonOutcome } from '$shared/signalk';
import type { TileDef } from './tile-catalog';

export const APP_LAUNCHER_BASE_PATH = '/signalk-app-launcher';

export type WebviewSourceKind = 'app' | 'link';
export type WebviewSourceState = 'ready' | 'absent' | 'failed';

export interface WebviewSource {
  // Stable source id: the app package name or the link id.
  id: string;
  title: string;
  description?: string;
  // Validated: a same-origin absolute path, or an http/https absolute URL.
  url: string;
  kind: WebviewSourceKind;
}

const MAX_WEBVIEW_TILES = 100;
const MAX_URL_LENGTH = 2048;

// A same-origin absolute path such as /signalk-tides/: one leading slash, a real first segment, no
// query or fragment. The first-segment rule also refuses protocol-relative //host strings, and the
// leading-segment colon check refuses anything that could read as a scheme.
const SAME_ORIGIN_PATH_RE = /^\/[A-Za-z0-9][^?#]*$/;

function isSameOriginPath(value: string): boolean {
  if (value.startsWith('//')) return false;
  if (!SAME_ORIGIN_PATH_RE.test(value)) return false;
  return !value.slice(0, value.indexOf('/') + 1).includes(':');
}

// Accept only a same-origin absolute path or an absolute http/https URL. Everything else is
// rejected, notably javascript:, data:, blob:, file:, and protocol-relative //host strings.
export function cleanWebviewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH || hasControlCharacters(trimmed))
    return undefined;
  if (isSameOriginPath(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// One endpoint's parse result. Undefined means the top-level body was not the documented shape,
// which is a broken provider rather than an empty catalog.
interface ParsedSources {
  sources: WebviewSource[];
  rejected: number;
}

function parseEntry(entry: unknown, kind: WebviewSourceKind): WebviewSource | undefined {
  if (!isRecord(entry)) return undefined;
  const id = cleanBoundedText(entry.id ?? entry.name, 64);
  const title = cleanBoundedText(entry.title, 80);
  const url = cleanWebviewUrl(entry.url);
  if (!id || !title || !url) return undefined;
  // An installed app must be a same-origin webapp mount; a curated link may be any http/https page.
  if (kind === 'app' && !isSameOriginPath(url)) return undefined;
  const description = cleanBoundedText(entry.description, 240);
  return {
    id,
    title,
    ...(description === undefined ? {} : { description }),
    url,
    kind,
  };
}

function parseEntries(entries: readonly unknown[], kind: WebviewSourceKind): ParsedSources {
  const sources: WebviewSource[] = [];
  let rejected = 0;
  for (const entry of entries) {
    const parsed = parseEntry(entry, kind);
    if (!parsed) {
      rejected += 1;
      continue;
    }
    sources.push(parsed);
  }
  return { sources, rejected };
}

function parseAppsForDiscovery(body: unknown): ParsedSources | undefined {
  if (!isRecord(body) || !Array.isArray(body.apps)) return undefined;
  return parseEntries(body.apps, 'app');
}

function parseLinksForDiscovery(body: unknown): ParsedSources | undefined {
  if (!isRecord(body) || !Array.isArray(body.links)) return undefined;
  return parseEntries(body.links, 'link');
}

export function parseLauncherApps(body: unknown): WebviewSource[] {
  const parsed = parseAppsForDiscovery(body);
  return parsed ? parsed.sources : [];
}

export function parseLauncherLinks(body: unknown): WebviewSource[] {
  const parsed = parseLinksForDiscovery(body);
  return parsed ? parsed.sources : [];
}

export function webviewTileDef(source: WebviewSource): TileDef {
  return {
    id: `webview:${source.kind}:${source.id}`,
    label: source.title,
    abbr: 'WEB',
    description: source.description
      ? `${source.title} web view. ${source.description}`
      : `${source.title} web view.`,
    sensorGloss: 'Web view unavailable',
    paths: [],
    zonesPath: '',
    useMetaDisplayName: false,
    category: 'apps',
    kind: 'webview',
    webview: { url: source.url, kind: source.kind },
    read: () => ({ state: 'live', value: 'WEB', unit: '', secondary: 'Web view' }),
  };
}

export interface WebviewDiscoveryResult {
  state: WebviewSourceState;
  tiles: TileDef[];
  rejected: number;
}

// Two same-origin GETs against the optional App Launcher plugin: the installed app list and the
// admin-curated link list. Every source is validated here, before it can reach reactive state.
export async function discoverWebviewInstruments(
  origin: string,
  token: string | undefined,
): Promise<WebviewDiscoveryResult> {
  const [appsOutcome, configOutcome] = await Promise.all([
    fetchAuthedJsonOutcome<unknown>(`${origin}${APP_LAUNCHER_BASE_PATH}/api/apps`, token),
    fetchAuthedJsonOutcome<unknown>(`${origin}${APP_LAUNCHER_BASE_PATH}/api/config`, token),
  ]);

  if (appsOutcome.state === 'failed' || configOutcome.state === 'failed') {
    return { state: 'failed', tiles: [], rejected: 0 };
  }
  if (appsOutcome.state !== 'ok' || configOutcome.state !== 'ok') {
    return { state: 'absent', tiles: [], rejected: 0 };
  }

  const apps = parseAppsForDiscovery(appsOutcome.value);
  const links = parseLinksForDiscovery(configOutcome.value);
  // A malformed top-level shape is a broken provider, not an empty catalog: report failed so any
  // previously accepted tiles are retained instead of erased.
  if (!apps || !links) return { state: 'failed', tiles: [], rejected: 0 };

  const rejected = apps.rejected + links.rejected;
  const seen = new Set<string>();
  const sources: WebviewSource[] = [];
  for (const source of [...apps.sources, ...links.sources]) {
    if (sources.length >= MAX_WEBVIEW_TILES) break;
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
  }
  if (sources.length === 0) return { state: 'absent', tiles: [], rejected };
  return { state: 'ready', tiles: sources.map(webviewTileDef), rejected };
}

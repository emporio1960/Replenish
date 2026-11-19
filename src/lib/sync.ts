/**
 * Sync across one person's devices, using a secret gist in their own GitHub
 * account as the shared file. Each device signs in with a personal access
 * token that only needs the "Gists" permission.
 *
 * The token and sync bookkeeping are kept in their own storage key, never in
 * the app data, so they are not included in exported backups or in the gist.
 */
import type { AppData } from '../types';
import { sanitize } from './storage';
import { uid } from './format';

export const SYNC_KEY = 'replenish:sync';
export const SYNC_FILE = 'replenish-sync.json';
const API = 'https://api.github.com';

export interface SyncConfig {
  token: string;
  gistId: string;
  deviceId: string;
  /** GitHub login the token belongs to, shown in Settings. */
  account: string;
  /** `savedAt` stamp of the remote copy this device last matched. */
  remoteStamp: string | null;
  /** When this device last finished a sync. */
  lastSyncedAt: string | null;
  /** True when this device has changes the remote copy does not. */
  dirty: boolean;
}

export interface RemoteCopy {
  savedAt: string;
  deviceId: string;
  data: AppData;
}

export class SyncError extends Error {
  kind: 'auth' | 'network' | 'missing' | 'other';
  constructor(kind: SyncError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SYNC_KEY) ?? 'null') as Partial<SyncConfig> | null;
    if (!raw || typeof raw.token !== 'string' || typeof raw.gistId !== 'string') return null;
    return {
      token: raw.token,
      gistId: raw.gistId,
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : uid(),
      account: typeof raw.account === 'string' ? raw.account : '',
      remoteStamp: typeof raw.remoteStamp === 'string' ? raw.remoteStamp : null,
      lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
      dirty: raw.dirty === true,
    };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig | null): void {
  try {
    if (config) window.localStorage.setItem(SYNC_KEY, JSON.stringify(config));
    else window.localStorage.removeItem(SYNC_KEY);
  } catch {
    /* storage unavailable: sync simply will not persist */
  }
}

async function github(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('network', 'Could not reach GitHub. Check your connection.');
  }
  if (res.status === 401) throw new SyncError('auth', 'GitHub did not accept the token. It may have expired or been revoked.');
  if (res.status === 403) {
    throw new SyncError('auth', 'The token is not allowed to do this. It needs the Gists permission set to read and write.');
  }
  if (res.status === 404) throw new SyncError('missing', 'The sync file was not found in your GitHub account.');
  if (!res.ok) throw new SyncError('other', `GitHub returned an error (${res.status}).`);
  return res;
}

interface GistFile {
  filename?: string;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}
interface Gist {
  id: string;
  files: Record<string, GistFile | null>;
}

/** Checks a token and finds this account's sync file, if one already exists. */
export async function connect(token: string, knownGistId?: string): Promise<{ account: string; gistId: string | null }> {
  const user = (await (await github(token, '/user')).json()) as { login?: string };
  const account = user.login ?? '';
  if (knownGistId) {
    await github(token, `/gists/${encodeURIComponent(knownGistId)}`);
    return { account, gistId: knownGistId };
  }
  for (let page = 1; page <= 5; page++) {
    const list = (await (await github(token, `/gists?per_page=100&page=${page}`)).json()) as Gist[];
    const found = list.find((g) => g.files && SYNC_FILE in g.files);
    if (found) return { account, gistId: found.id };
    if (list.length < 100) break;
  }
  return { account, gistId: null };
}

function body(copy: RemoteCopy): string {
  return JSON.stringify({
    description: 'Replenish sync data (managed by the Replenish app; do not edit by hand)',
    public: false,
    files: { [SYNC_FILE]: { content: JSON.stringify(copy) } },
  });
}

export async function createRemote(token: string, copy: RemoteCopy): Promise<string> {
  const gist = (await (await github(token, '/gists', { method: 'POST', body: body(copy) })).json()) as Gist;
  return gist.id;
}

export async function pushRemote(token: string, gistId: string, copy: RemoteCopy): Promise<void> {
  await github(token, `/gists/${encodeURIComponent(gistId)}`, { method: 'PATCH', body: body(copy) });
}

/** Reads the remote copy. Returns null when the file exists but holds nothing usable. */
export async function pullRemote(token: string, gistId: string): Promise<RemoteCopy | null> {
  const gist = (await (await github(token, `/gists/${encodeURIComponent(gistId)}`)).json()) as Gist;
  const file = gist.files?.[SYNC_FILE];
  if (!file) return null;
  let text = file.content ?? '';
  // GitHub cuts off large files in this response; the full text is at raw_url.
  if (file.truncated && file.raw_url) {
    try {
      text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
    } catch {
      throw new SyncError('network', 'Could not download the sync file from GitHub.');
    }
  }
  try {
    const parsed = JSON.parse(text) as Partial<RemoteCopy>;
    if (typeof parsed.savedAt !== 'string' || !parsed.data) return null;
    return {
      savedAt: parsed.savedAt,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      data: sanitize(parsed.data),
    };
  } catch {
    return null;
  }
}

export type SyncStep = 'push' | 'pull' | 'none' | 'conflict';

/**
 * What a sync should do, given whether this device has unsynced changes and
 * whether the remote copy has moved on since this device last matched it.
 */
export function decide(config: Pick<SyncConfig, 'remoteStamp' | 'dirty'>, remote: Pick<RemoteCopy, 'savedAt'> | null): SyncStep {
  if (!remote) return 'push';
  const remoteChanged = remote.savedAt !== config.remoteStamp;
  if (!remoteChanged) return config.dirty ? 'push' : 'none';
  return config.dirty ? 'conflict' : 'pull';
}

/**
 * Combines two diverged copies: every record from both, with this device's
 * version winning where both have the same record. Because deletions are not
 * tracked, something deleted on one device can come back.
 */
export function combine(local: AppData, remote: AppData): AppData {
  const union = <T extends { id: string }>(mine: T[], theirs: T[]): T[] => {
    const ids = new Set(mine.map((x) => x.id));
    return [...mine, ...theirs.filter((x) => !ids.has(x.id))];
  };
  return sanitize({
    ...local,
    items: union(local.items, remote.items),
    recurring: union(local.recurring, remote.recurring),
    history: union(local.history, remote.history),
    deferrals: union(local.deferrals, remote.deferrals),
    categories: union(local.categories, remote.categories),
    stores: union(local.stores, remote.stores),
    recipes: union(local.recipes, remote.recipes),
    imports: union(local.imports, remote.imports),
    notices: union(local.notices, remote.notices),
    barcodes: { ...remote.barcodes, ...local.barcodes },
    categoryRules: { ...remote.categoryRules, ...local.categoryRules },
    replenishPrefs: { ...remote.replenishPrefs, ...local.replenishPrefs },
  });
}

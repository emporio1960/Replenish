import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppData } from '../types';
import { uid } from '../lib/format';
import {
  combine, connect as connectAccount, createRemote, decide, loadSyncConfig, pullRemote, pushRemote,
  saveSyncConfig, SyncError, type RemoteCopy, type SyncConfig,
} from '../lib/sync';
import { processDue } from './actions';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'conflict';

export interface SyncApi {
  status: SyncStatus;
  error: string | null;
  account: string;
  gistId: string;
  lastSyncedAt: string | null;
  /** Connects this device. Resolves to an error message, or null on success. */
  connect: (token: string, gistId?: string) => Promise<string | null>;
  disconnect: () => void;
  syncNow: () => void;
  /** Settles a conflict: keep this device's data, take the other device's, or combine both. */
  resolve: (choice: 'mine' | 'theirs' | 'combine') => void;
}

const hasContent = (d: AppData) =>
  d.items.length + d.recurring.length + d.history.length + d.recipes.length + d.stores.length > 0;

const message = (e: unknown) => (e instanceof SyncError ? e.message : 'Sync failed unexpectedly.');

export function useSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>): SyncApi {
  const [config, setConfigState] = useState<SyncConfig | null>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus>(config ? 'idle' : 'off');
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef(config);
  const dataRef = useRef(data);
  const statusRef = useRef(status);
  const running = useRef(false);
  const conflict = useRef<RemoteCopy | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const setConfig = useCallback((next: SyncConfig | null) => {
    configRef.current = next;
    setConfigState(next);
    saveSyncConfig(next);
  }, []);
  const mark = useCallback((s: SyncStatus, err: string | null = null) => {
    statusRef.current = s;
    setStatus(s);
    setError(err);
  }, []);

  const takeRemote = useCallback(
    (remote: RemoteCopy) => {
      const next = processDue(remote.data, new Date());
      dataRef.current = next;
      setData(next);
      const cfg = configRef.current;
      if (cfg) setConfig({ ...cfg, remoteStamp: remote.savedAt, dirty: false, lastSyncedAt: new Date().toISOString() });
    },
    [setConfig, setData],
  );

  const run = useCallback(async () => {
    const start = configRef.current;
    if (!start || running.current || statusRef.current === 'conflict') return;
    running.current = true;
    mark('syncing');
    try {
      const remote = await pullRemote(start.token, start.gistId);
      const cfg = configRef.current;
      if (!cfg) return;
      const step = decide(cfg, remote);
      if (step === 'conflict' && remote) {
        conflict.current = remote;
        mark('conflict');
        return;
      }
      if (step === 'pull' && remote) {
        takeRemote(remote);
      } else if (step === 'push') {
        const snapshot = dataRef.current;
        const savedAt = new Date().toISOString();
        await pushRemote(cfg.token, cfg.gistId, { savedAt, deviceId: cfg.deviceId, data: snapshot });
        const latest = configRef.current;
        // Anything changed while the upload was in flight stays marked for the next sync.
        if (latest) setConfig({ ...latest, remoteStamp: savedAt, lastSyncedAt: savedAt, dirty: dataRef.current !== snapshot });
      } else {
        setConfig({ ...cfg, lastSyncedAt: new Date().toISOString() });
      }
      mark('idle');
    } catch (e) {
      mark('error', message(e));
    } finally {
      running.current = false;
      if (configRef.current?.dirty && statusRef.current === 'idle') {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void run(), 3000);
      }
    }
  }, [mark, setConfig, takeRemote]);

  // Local changes: mark this device as ahead and sync shortly after the user pauses.
  useEffect(() => {
    // Same object as last seen: first render, or data this hook just applied itself.
    if (dataRef.current === data) return;
    dataRef.current = data;
    const cfg = configRef.current;
    if (!cfg) return;
    if (!cfg.dirty) setConfig({ ...cfg, dirty: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), 3000);
  }, [data, run, setConfig]);

  // Sync on opening the app, on returning to it, when the connection comes back, and every few minutes.
  useEffect(() => {
    void run();
    const onVisible = () => document.visibilityState === 'visible' && void run();
    const onOnline = () => void run();
    const interval = window.setInterval(() => document.visibilityState === 'visible' && void run(), 120_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [run]);

  const connect = useCallback(
    async (rawToken: string, knownGistId?: string) => {
      const token = rawToken.trim();
      if (!token) return 'Paste your GitHub access token.';
      try {
        const found = await connectAccount(token, knownGistId?.trim() || undefined);
        const deviceId = uid();
        const local = dataRef.current;
        if (found.gistId) {
          // Another device already syncs here. If this device has data of its own,
          // the first sync asks which copy to keep rather than guessing.
          setConfig({
            token, gistId: found.gistId, deviceId, account: found.account,
            remoteStamp: null, lastSyncedAt: null, dirty: hasContent(local),
          });
        } else {
          const savedAt = new Date().toISOString();
          const gistId = await createRemote(token, { savedAt, deviceId, data: local });
          setConfig({ token, gistId, deviceId, account: found.account, remoteStamp: savedAt, lastSyncedAt: savedAt, dirty: false });
        }
        mark('idle');
        void run();
        return null;
      } catch (e) {
        return message(e);
      }
    },
    [mark, run, setConfig],
  );

  const disconnect = useCallback(() => {
    window.clearTimeout(timer.current);
    conflict.current = null;
    setConfig(null);
    mark('off');
  }, [mark, setConfig]);

  const resolve = useCallback(
    (choice: 'mine' | 'theirs' | 'combine') => {
      const remote = conflict.current;
      const cfg = configRef.current;
      if (!remote || !cfg) return;
      conflict.current = null;
      mark('idle');
      if (choice === 'theirs') {
        takeRemote(remote);
        return;
      }
      if (choice === 'combine') {
        const merged = combine(dataRef.current, remote.data);
        dataRef.current = merged;
        setData(merged);
      }
      // This device's copy now supersedes the remote one it was compared with.
      setConfig({ ...cfg, remoteStamp: remote.savedAt, dirty: true });
      void run();
    },
    [mark, run, setConfig, setData, takeRemote],
  );

  const syncNow = useCallback(() => void run(), [run]);

  return {
    status,
    error,
    account: config?.account ?? '',
    gistId: config?.gistId ?? '',
    lastSyncedAt: config?.lastSyncedAt ?? null,
    connect,
    disconnect,
    syncNow,
    resolve,
  };
}

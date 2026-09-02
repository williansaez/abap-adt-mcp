/**
 * Per-session ledger of ADT locks the server holds, keyed by the ADTClient
 * (one per destination). Lets write tools lock/write/unlock in one call,
 * reuse a lock the model acquired explicitly, list what is held, and release
 * everything on logout, session reset or forceUnlock.
 */
import { session_types } from 'abap-adt-api';
import { objectUrlOf } from './policy.js';

export interface LockEntry {
  objectUrl: string;
  lockHandle: string;
  accessMode?: string;
  acquiredAt: string;
  /** true when a tool acquired it implicitly and will release it itself */
  auto?: boolean;
}

type LockClient = {
  stateful: any;
  lock(objectUrl: string, accessMode?: string): Promise<{ LOCK_HANDLE: string } & Record<string, any>>;
  unLock(objectUrl: string, lockHandle: string): Promise<any>;
};

const ledgers = new WeakMap<object, Map<string, LockEntry>>();

export function ledgerFor(client: object): Map<string, LockEntry> {
  let m = ledgers.get(client);
  if (!m) { m = new Map(); ledgers.set(client, m); }
  return m;
}

export const lockKey = (objectUrl: string) => objectUrlOf(objectUrl).toLowerCase();

export function recordLock(client: object, objectUrl: string, lockHandle: string, accessMode?: string, auto = false): LockEntry {
  const entry: LockEntry = { objectUrl: objectUrlOf(objectUrl), lockHandle, accessMode, acquiredAt: new Date().toISOString(), auto };
  ledgerFor(client).set(lockKey(objectUrl), entry);
  return entry;
}

export function findLock(client: object, objectUrl: string): LockEntry | undefined {
  return ledgerFor(client).get(lockKey(objectUrl));
}

export function forgetLock(client: object, objectUrl: string): void {
  ledgerFor(client).delete(lockKey(objectUrl));
}

export function listLocks(client: object): LockEntry[] {
  return [...ledgerFor(client).values()];
}

/** Release every recorded lock (best effort); returns what was released and what failed. */
export async function releaseAll(client: LockClient): Promise<{ released: string[]; failed: Array<{ objectUrl: string; error: string }> }> {
  const released: string[] = [];
  const failed: Array<{ objectUrl: string; error: string }> = [];
  for (const entry of listLocks(client)) {
    try {
      client.stateful = session_types.stateful;
      await client.unLock(entry.objectUrl, entry.lockHandle);
      released.push(entry.objectUrl);
    } catch (e: any) {
      failed.push({ objectUrl: entry.objectUrl, error: String(e?.message || e) });
    }
    forgetLock(client, entry.objectUrl);
  }
  return { released, failed };
}

/** Drop all entries without talking to SAP (session is gone, handles are dead). */
export function clearLedger(client: object): void {
  ledgerFor(client).clear();
}

export interface WithLockResult<T> {
  result: T;
  lockHandle: string;
  /** 'explicit' = caller passed a handle; 'reused' = ledger had one; 'auto' = acquired and released here */
  lockMode: 'explicit' | 'reused' | 'auto';
  unlockError?: string;
}

/**
 * Run `fn(lockHandle)` under a lock on objectUrl. With an explicit handle or a
 * ledger entry the lock is left in place (the caller owns it). Otherwise the
 * object is locked here and unlocked afterwards, also on failure; an unlock
 * failure is reported, never swallowed. `keepOnSuccess` skips the release
 * (used by deleteObject, where the object no longer exists).
 */
export async function withLock<T>(
  client: LockClient, objectUrl: string, explicitHandle: string | undefined,
  fn: (lockHandle: string) => Promise<T>, opts: { accessMode?: string; keepOnSuccess?: boolean } = {}
): Promise<WithLockResult<T>> {
  if (explicitHandle) {
    return { result: await fn(explicitHandle), lockHandle: explicitHandle, lockMode: 'explicit' };
  }
  const existing = findLock(client, objectUrl);
  if (existing) {
    return { result: await fn(existing.lockHandle), lockHandle: existing.lockHandle, lockMode: 'reused' };
  }
  client.stateful = session_types.stateful;
  const lock = await client.lock(objectUrlOf(objectUrl), opts.accessMode);
  const handle = lock.LOCK_HANDLE;
  recordLock(client, objectUrl, handle, opts.accessMode, true);
  let result: T;
  try {
    result = await fn(handle);
  } catch (error) {
    try { await client.unLock(objectUrlOf(objectUrl), handle); } catch { /* the original error matters more */ }
    forgetLock(client, objectUrl);
    throw error;
  }
  if (opts.keepOnSuccess) {
    forgetLock(client, objectUrl);
    return { result, lockHandle: handle, lockMode: 'auto' };
  }
  let unlockError: string | undefined;
  try {
    await client.unLock(objectUrlOf(objectUrl), handle);
  } catch (e: any) {
    unlockError = String(e?.message || e);
  }
  forgetLock(client, objectUrl);
  return { result, lockHandle: handle, lockMode: 'auto', unlockError };
}

/** Object name (upper case) from an ADT object URL, for activateByName. */
export function objectNameFromUrl(objectUrl: string): string {
  const clean = objectUrlOf(objectUrl);
  const last = clean.split('/').filter(Boolean).pop() || '';
  return decodeURIComponent(last).toUpperCase();
}

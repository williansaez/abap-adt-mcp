/**
 * Cache of ABAP object source keyed by ADT client (one per destination and
 * per MCP session) and source URL, with a short TTL. It lets syntaxCheckCode
 * reuse the source last read/written and spares grepPackage / cdsViewInfo /
 * typeHierarchy a re-download, without ever serving one destination's (or one
 * user's) source to another: the same ADT URL exists on every system.
 */
const DEFAULT_TTL_MS = 5 * 60_000;
const ttlMs = (() => {
  const v = Number(process.env.MCP_SOURCE_CACHE_TTL_SECONDS);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : DEFAULT_TTL_MS;
})();

type Entry = { source: string; at: number; epoch: number };
const caches = new WeakMap<object, Map<string, Entry>>();
// Bumping the epoch invalidates every entry of every client without holding
// strong references to the clients (WeakMap is not enumerable).
let epoch = 0;

function bucket(client: object): Map<string, Entry> {
  let m = caches.get(client);
  if (!m) { m = new Map(); caches.set(client, m); }
  return m;
}

export const sourceCache = {
  set(client: object, url: string, source: string): void {
    if (client && typeof url === 'string' && url.length > 0 && typeof source === 'string') {
      bucket(client).set(url, { source, at: Date.now(), epoch });
    }
  },
  get(client: object, url: string): string | undefined {
    const e = client ? caches.get(client)?.get(url) : undefined;
    if (!e) return undefined;
    if (e.epoch !== epoch || (ttlMs > 0 && Date.now() - e.at > ttlMs)) { caches.get(client)?.delete(url); return undefined; }
    return e.source;
  },
  has(client: object, url: string): boolean {
    return this.get(client, url) !== undefined;
  },
  delete(client: object, url: string): void {
    caches.get(client)?.delete(url);
  },
  /** Forget everything for one client (logout, session reset) or, without a client, for all of them (tests). */
  clear(client?: object): void {
    if (client) { caches.get(client)?.clear(); return; }
    epoch++;
  },
};

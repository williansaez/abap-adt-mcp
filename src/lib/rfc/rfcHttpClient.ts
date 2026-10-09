/**
 * abap-adt-api HttpClient that carries every ADT REST request over RFC, one
 * call of SADT_REST_RFC_ENDPOINT per request, the way Eclipse talks to
 * on-premise systems (see types.ts for why).
 *
 * Each RFC connection is one ABAP user session. Two of them per destination:
 *   - enqueue: LOCK and UNLOCK only. Its session holds the enqueue locks and
 *     lives until the server ends it (dropSession, logout, close).
 *   - work: everything else. In "split" mode its ABAP context is reset after
 *     every write, so session buffers never leak into the next request (a
 *     second save failing with PAK/058, a read after create with
 *     SADT_RESOURCE/007).
 * In "single" mode one connection carries everything and is not reset after
 * writes. Both are opened lazily and reopened lazily after a loss.
 *
 * There is no CSRF over RFC: every response carries a synthetic token so the
 * library never believes it is logged out. Cookies and Authorization never
 * reach SAP; the RFC logon (user and password, or a MYSAPSSO2 ticket) is the
 * only credential.
 */
import http from 'http';
import type { HttpClient, HttpClientException, HttpClientOptions, HttpClientResponse } from 'abap-adt-api/build/AdtHTTP';
import type { SystemConfig } from '../systems.js';
import { RFC_RC, RfcConnection, RfcConnector, RfcError, RfcLogonParams, SadtHeader, SadtRequest, SadtResponse } from './types.js';

export interface RfcHttpClientOptions {
  /** Destination name, used in error messages. */
  destination: string;
  /** Loads the NW RFC SDK binding (lazily, on the first request). */
  connector: () => Promise<RfcConnector>;
  /** SDK logon parameters, read each time a connection is opened. */
  logonParams: () => Promise<RfcLogonParams>;
  sessions: 'split' | 'single';
  /** Called when the connection that holds the locks is gone without the server asking for it. */
  onSessionLost?: (reason: string) => void;
  /** Waits before each new logon attempt after a logon cut off by SAP (see logonCutOff); tests pass zeros. */
  logonRetryDelaysMs?: number[];
}

/**
 * SAP accepted the connection and closed it during the logon, without an
 * answer. Seen on P03 right after all sessions of the user were ended in SM04:
 * new RFC logons failed this way for well under 90 seconds, then the same
 * ticket worked again. A wrong host or a closed port fails with
 * RFC_COMMUNICATION_FAILURE instead and is not retried.
 */
function logonCutOff(e: unknown): boolean {
  return isRfcError(e) && e.rfcCode === RFC_RC.RFC_CLOSED && /CM_NO_DATA_RECEIVED/.test(String((e as any).message ?? ''));
}

const DEFAULT_LOGON_RETRY_DELAYS_MS = [3000, 7000, 15000];

type SlotName = 'enqueue' | 'work' | 'single';

interface Slot {
  readonly name: SlotName;
  /** The enqueue locks of the destination live in this connection's session. */
  readonly holdsLocks: boolean;
  conn?: RfcConnection;
  /** Serializes everything that touches this connection. */
  chain: Promise<unknown>;
  /** Objects this connection's session holds enqueue locks on (LOCK answered, UNLOCK not yet). */
  locked: Set<string>;
}

const ACTIVATION_PATH = '/sap/bc/adt/activation';

const GRAPH_PATH = '/sap/bc/adt/compatibility/graph';
const LOGOFF_PATH = '/sap/public/bc/icf/logoff';
/** The RFC logon fixes client and language; ICF would only be confused by them. */
const DROPPED_QUERY_KEYS = new Set(['sap-client', 'sap-language']);
/** Never forwarded to SAP (case-insensitive). */
const STRIPPED_HEADERS = new Set(['cookie', 'authorization', 'x-csrf-token', 'x-sap-adt-sessiontype', 'accept-encoding', 'content-length', 'host']);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * The Change and Transport System resources moved under /sap/bc/adt/cts/ in
 * later releases; SAP_BASIS 7.40 still serves them at /sap/bc/cts/ (its ADT
 * discovery lists /sap/bc/cts/transports, transportchecks, transportrequests).
 * abap-adt-api calls the new path, which such a system answers with 404.
 */
const CTS_ADT_PREFIX = '/sap/bc/adt/cts/';
const CTS_LEGACY_PREFIX = '/sap/bc/cts/';

/** The same request on the older CTS path, or undefined when uri is not a CTS request. */
export function legacyCtsUri(uri: string): string | undefined {
  return uri.startsWith(CTS_ADT_PREFIX) ? CTS_LEGACY_PREFIX + uri.slice(CTS_ADT_PREFIX.length) : undefined;
}
/** Status for an <exc:exception> body when an old release sends no STATUS_CODE. */
const EXCEPTION_STATUS: Record<string, number> = {
  ExceptionResourceNotFound: 404,
  ExceptionResourceInvalidLockHandle: 423,
  ExceptionResourceNoAccess: 403,
  ExceptionResourceLocked: 403,
  ExceptionNotAuthorized: 403,
  ExceptionResourceAlreadyExists: 409,
};

export const SYNTHETIC_CSRF_TOKEN = 'rfc';

/**
 * abap-adt-api's HttpClientException, loaded on first use: it is not exported
 * from the package entry, and an HTTP-only process should never touch the
 * library's internal build path.
 */
function httpClientExceptionClass(): typeof HttpClientException {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('abap-adt-api/build/AdtHTTP').HttpClientException;
}

function isRfcError(e: unknown): e is RfcError {
  return e instanceof RfcError
    || (!!e && typeof e === 'object' && typeof (e as any).rfcCode === 'number' && typeof (e as any).rfcCodeName === 'string');
}

function connectionLost(e: unknown): boolean {
  return isRfcError(e) && (e as { connectionLost?: boolean }).connectionLost === true;
}

/** The SDK ended the ABAP session with this error (connection loss, ABAP message, short dump). */
function closesConnection(e: unknown): boolean {
  if (!isRfcError(e)) return false;
  return (e as { closesConnection?: boolean }).closesConnection === true || connectionLost(e)
    || e.rfcCode === RFC_RC.RFC_ABAP_MESSAGE || e.rfcCode === RFC_RC.RFC_ABAP_RUNTIME_FAILURE;
}

function logonFailure(e: unknown): boolean {
  return isRfcError(e) && e.rfcCode === RFC_RC.RFC_LOGON_FAILURE;
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  let found: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v !== undefined && v !== null) found = String(v);
  }
  return found;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

function qsValueToString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

interface Target {
  path: string;
  /** Raw (already encoded) query pairs from the URL itself. */
  urlPairs: string[];
}

/** Path and query of the library URL; scheme and host of an absolute URL are dropped. */
function parseTarget(url: string): Target {
  const u = new URL(url || '/', 'http://rfc.invalid/');
  return { path: u.pathname || '/', urlPairs: u.search.replace(/^\?/, '').split('&').filter(Boolean) };
}

function pairKey(pair: string): string {
  const eq = pair.indexOf('=');
  return safeDecode(eq < 0 ? pair : pair.slice(0, eq));
}

function pairValue(pair: string): string {
  const eq = pair.indexOf('=');
  return eq < 0 ? '' : safeDecode(pair.slice(eq + 1));
}

function qsEntries(qs: Record<string, unknown> | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, raw] of Object.entries(qs || {})) {
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      if (v === undefined || v === null) continue;
      out.push([k, qsValueToString(v)]);
    }
  }
  return out;
}

/** Request URI as SADT_REST_RFC_ENDPOINT expects it: path plus the merged, encoded query. */
export function buildUri(url: string, qs?: Record<string, unknown>): string {
  const t = parseTarget(url);
  // Pairs the URL already carries are encoded by whoever built it; re-encoding
  // them would double-encode every %XX.
  const pairs = t.urlPairs.filter(p => !DROPPED_QUERY_KEYS.has(pairKey(p).toLowerCase()));
  for (const [k, v] of qsEntries(qs)) {
    if (DROPPED_QUERY_KEYS.has(k.toLowerCase())) continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return pairs.length ? `${t.path}?${pairs.join('&')}` : t.path;
}

/** LOCK and UNLOCK belong to the enqueue session. Routed on _action, never on the session header. */
export function isLockRequest(url: string, qs?: Record<string, unknown>): boolean {
  const actions = [
    ...parseTarget(url).urlPairs.filter(p => pairKey(p) === '_action').map(pairValue),
    ...qsEntries(qs).filter(([k]) => k === '_action').map(([, v]) => v),
  ];
  return actions.some(a => /^(LOCK|UNLOCK)$/i.test(a.trim()));
}

/** Headers forwarded to SAP: everything but session, cookie, auth and transport headers; Accept always present. */
export function buildHeaders(headers: Record<string, unknown> | undefined): SadtHeader[] {
  const byName = new Map<string, SadtHeader>();
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (STRIPPED_HEADERS.has(lower) || value === undefined || value === null) continue;
    byName.set(lower, { name, value: Array.isArray(value) ? value.map(String).join(', ') : String(value) });
  }
  // SAP answers 400 "Accept header missing" without one.
  if (!byName.get('accept')?.value.trim()) byName.set('accept', { name: 'Accept', value: '*/*' });
  return [...byName.values()];
}

function bodyBuffer(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body), 'utf8');
}

function isBinaryContentType(contentType: string | undefined): boolean {
  return /^\s*(application\/(octet-stream|zip)|image\/)/i.test(contentType || '');
}

/** Status of a response whose STATUS_CODE is empty (reported on BASIS below 7.50). */
export function deriveStatus(body: string): number {
  if (!body.includes('<exc:exception')) return 200;
  const type = body.match(/<type\s+id=["']([^"']+)["']/)?.[1] || '';
  return EXCEPTION_STATUS[type] ?? 400;
}

/** SADT response -> the library's response shape. */
export function toHttpResponse(res: SadtResponse, head = false): HttpClientResponse {
  const headers: Record<string, string | string[]> = {};
  for (const h of res.headers || []) {
    const name = String(h?.name ?? '').trim().toLowerCase();
    // The first rows are ICF pseudo headers such as ~server_protocol.
    if (!name || name.startsWith('~')) continue;
    const value = String(h.value ?? '');
    const prev = headers[name];
    headers[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  // The library iterates set-cookie as an array.
  if (typeof headers['set-cookie'] === 'string') headers['set-cookie'] = [headers['set-cookie'] as string];
  const contentType = headers['content-type'];
  const buf = res.body ? Buffer.from(res.body) : Buffer.alloc(0);
  const text = buf.toString(isBinaryContentType(Array.isArray(contentType) ? contentType[0] : contentType) ? 'latin1' : 'utf8');
  let status = parseInt(String(res.statusCode ?? '').trim(), 10);
  if (!Number.isFinite(status) || status < 100) status = deriveStatus(text);
  headers['x-csrf-token'] = SYNTHETIC_CSRF_TOKEN;
  return {
    body: head ? '' : text,
    status,
    statusText: res.reasonPhrase || http.STATUS_CODES[status] || '',
    headers: headers as HttpClientResponse['headers'],
  };
}

export class RfcHttpClient implements HttpClient {
  private readonly enqueue: Slot;
  private readonly work: Slot;
  private override: RfcLogonParams = {};
  /** Set once the system answered a /sap/bc/adt/cts/ request with 404 and served it on /sap/bc/cts/. */
  private ctsLegacy = false;
  /**
   * Set after SAP refused a password logon: no further password logon is
   * attempted until allowLogonAgain() (the login tool) or a restart, so failed
   * attempts cannot add up to a locked SAP user (login/fails_to_user_lock).
   */
  private refusedLogon?: string;

  constructor(private readonly options: RfcHttpClientOptions) {
    if (options.sessions === 'single') {
      this.enqueue = this.work = { name: 'single', holdsLocks: true, chain: Promise.resolve(), locked: new Set() };
    } else {
      this.enqueue = { name: 'enqueue', holdsLocks: true, chain: Promise.resolve(), locked: new Set() };
      this.work = { name: 'work', holdsLocks: false, chain: Promise.resolve(), locked: new Set() };
    }
  }

  get destination(): string { return this.options.destination; }
  get sessions(): 'split' | 'single' { return this.options.sessions; }

  async request(options: HttpClientOptions): Promise<HttpClientResponse> {
    const method = String(options.method || 'GET').toUpperCase();
    const target = parseTarget(options.url);
    const qs = options.qs as Record<string, unknown> | undefined;

    // Logoff never reaches SAP: closing the connections ends both sessions.
    if (target.path === LOGOFF_PATH) {
      await this.close();
      return { body: '', status: 200, statusText: 'OK', headers: { 'x-csrf-token': SYNTHETIC_CSRF_TOKEN } };
    }

    // abap-adt-api's dropSession(): a bare stateless GET of the graph.
    const sessionType = headerValue(options.headers as Record<string, unknown>, 'X-sap-adt-sessiontype');
    if (method === 'GET' && target.path === GRAPH_PATH && target.urlPairs.length === 0
      && qsEntries(qs).length === 0 && sessionType?.toLowerCase() === 'stateless') {
      await this.endStatefulSession();
    }

    const lockAction = isLockRequest(options.url, qs);
    // SAP checks at activation that the enqueue lock belongs to the activating
    // session. While the enqueue session holds a lock (an explicit lock kept
    // across writes), activation in the work session fails with "user X is
    // already editing": send it where the lock lives, as Eclipse does in its
    // one session.
    const activatesUnderLock = method === 'POST' && target.path === ACTIVATION_PATH && this.enqueue !== this.work && this.enqueue.locked.size > 0;
    const slot = lockAction || activatesUnderLock ? this.enqueue : this.work;
    const uri = buildUri(options.url, qs);
    const sadt: SadtRequest = {
      method: method === 'HEAD' ? 'GET' : method,
      uri: this.ctsLegacy ? (legacyCtsUri(uri) ?? uri) : uri,
      version: 'HTTP/1.1',
      headers: buildHeaders(options.headers as Record<string, unknown>),
      body: bodyBuffer((options as { body?: unknown }).body),
    };
    const isRead = READ_METHODS.has(method);

    let res = await this.send(slot, sadt, options, isRead);
    // A 404 on the newer CTS path means the request was not executed: ask the
    // older path once, and keep using it for this destination when it answers.
    const legacy = !this.ctsLegacy ? legacyCtsUri(sadt.uri) : undefined;
    if (legacy && toHttpResponse(res).status === 404) {
      const retry = await this.send(slot, { ...sadt, uri: legacy }, options, isRead);
      if (toHttpResponse(retry).status !== 404) {
        this.ctsLegacy = true;
        res = retry;
      }
    }
    if (lockAction && toHttpResponse(res).status < 400) {
      const action = String(qsEntries(qs).find(([k]) => k === '_action')?.[1] ?? parseTarget(options.url).urlPairs.filter(p => pairKey(p) === '_action').map(pairValue)[0] ?? '').trim().toUpperCase();
      if (action === 'LOCK') slot.locked.add(target.path.toLowerCase());
      else slot.locked.delete(target.path.toLowerCase());
    }
    return toHttpResponse(res, method === 'HEAD');
  }

  /** One SADT_REST_RFC_ENDPOINT call on the slot's connection, serialized with the slot's other calls. */
  private send(slot: Slot, sadt: SadtRequest, options: HttpClientOptions, isRead: boolean): Promise<SadtResponse> {
    return this.serialize(slot, async () => {
      const reused = !!slot.conn && !slot.conn.closed;
      let conn = await this.acquire(slot, options);
      let out: SadtResponse;
      try {
        out = await this.call(slot, conn, sadt, options);
      } catch (e) {
        // An idle connection the network or the gateway dropped: a read is
        // safe to repeat once on a fresh connection.
        if (!(isRead && reused && !slot.conn && (e as any)?.rfcLost)) throw e;
        conn = await this.acquire(slot, options);
        out = await this.call(slot, conn, sadt, options);
      }
      if (this.options.sessions === 'split' && slot === this.work && !isRead) await this.resetQuietly(slot);
      return out;
    });
  }

  /**
   * End the stateful session: reset the context of the connection that holds
   * the locks, which releases them. Never fails; a connection that cannot be
   * reset is closed, which ends its session as well.
   */
  endStatefulSession(): Promise<void> {
    const slot = this.enqueue;
    return this.serialize(slot, async () => {
      const conn = slot.conn;
      if (!conn) return;
      if (conn.closed) { await this.forget(slot); return; }
      try { await conn.reset(); slot.locked.clear(); } catch { await this.forget(slot); }
    });
  }

  /** Close both connections (after the calls already queued on them). They reopen on the next request. */
  async close(): Promise<void> {
    const slots = this.enqueue === this.work ? [this.enqueue] : [this.enqueue, this.work];
    await Promise.all(slots.map(slot => this.serialize(slot, () => this.forget(slot))));
  }

  /**
   * Logon parameters that win over logonParams() (a fresh MYSAPSSO2 ticket);
   * an undefined value removes one. Both connections are closed so the next
   * request logs on with them.
   */
  /** Allow one new password logon after a refusal (called for an explicit login). */
  allowLogonAgain(): void {
    this.refusedLogon = undefined;
  }

  async setLogonOverride(params: Partial<RfcLogonParams>): Promise<void> {
    this.refusedLogon = undefined;
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) delete this.override[k];
      else this.override[k] = v;
    }
    await this.close();
  }

  // --- internals -----------------------------------------------------------

  private serialize<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
    const run = slot.chain.then(fn);
    slot.chain = run.catch(() => undefined);
    return run;
  }

  private async forget(slot: Slot): Promise<void> {
    const conn = slot.conn;
    slot.conn = undefined;
    slot.locked.clear();
    if (conn) {
      try { await conn.close(); } catch { /* the connection is gone either way */ }
    }
  }

  private lost(slot: Slot, err: unknown): void {
    if (!slot.holdsLocks) return;
    const code = isRfcError(err) ? err.rfcCodeName : 'closed';
    try {
      this.options.onSessionLost?.(`RFC session of ${this.options.destination} ended (${code}): locks held in the RFC session are gone; lock the objects again before writing`);
    } catch { /* a listener must not break the request */ }
  }

  private async acquire(slot: Slot, request: HttpClientOptions): Promise<RfcConnection> {
    if (slot.conn?.closed) {
      await this.forget(slot);
      this.lost(slot, undefined);
    }
    if (!slot.conn) slot.conn = await this.open(request);
    return slot.conn;
  }

  private async open(request: HttpClientOptions): Promise<RfcConnection> {
    let connector: RfcConnector;
    let params: RfcLogonParams;
    try {
      connector = await this.options.connector();
      params = { ...(await this.options.logonParams()), ...this.override };
    } catch (e) {
      throw this.wrap(e, 'open', request);
    }
    if (this.refusedLogon && !params.MYSAPSSO2) {
      throw this.exception(`${this.refusedLogon} No new logon was attempted: fix the password, then restart the host or call login for ${this.options.destination}.`, 'RFC_LOGON_FAILURE', undefined, request);
    }
    if (!params.USER && !params.MYSAPSSO2 && !Object.keys(params).some(k => k.startsWith('SNC_'))) {
      throw this.exception(`RFC logon to ${this.options.destination} failed: no user and no logon ticket; log in first`, 'RFC_LOGON_FAILURE', 401, request);
    }
    const delays = this.options.logonRetryDelaysMs ?? DEFAULT_LOGON_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await connector.open(params);
      } catch (e) {
        if (logonCutOff(e)) {
          if (attempt < delays.length) {
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            continue;
          }
          const msg = (e as any)?.message ? String((e as any).message) : String(e);
          const waited = Math.round(delays.reduce((a, b) => a + b, 0) / 1000);
          throw this.exception(`RFC connection to ${this.options.destination} could not be opened (RFC_CLOSED): SAP closed the connection during the logon ${attempt + 1} times over ${waited} seconds (${msg}). This happens for a short while after the user's sessions were ended (SM04): try again in a minute. If it goes on, call login for ${this.options.destination}.`, 'RFC_CLOSED', undefined, request, e);
        }
        // A refused ticket logon is an expired SSO session: answer 401 so the
        // server logs in again once. A refused password logon is not retried, so
        // repeated attempts cannot lock the SAP user.
        if (logonFailure(e) && !params.MYSAPSSO2) {
          const msg = (e as any)?.message ? String((e as any).message) : String(e);
          this.refusedLogon = `RFC logon to ${this.options.destination} was refused: ${msg}.`;
          throw this.exception(`${this.refusedLogon} The server makes no further logon attempt for this destination until login is called or the server restarts, so failed attempts cannot add up to a locked SAP user.`, 'RFC_LOGON_FAILURE', undefined, request, e);
        }
        throw this.wrap(e, 'open', request);
      }
    }
  }

  private async call(slot: Slot, conn: RfcConnection, req: SadtRequest, request: HttpClientOptions): Promise<SadtResponse> {
    try {
      return await conn.callAdt(req);
    } catch (e) {
      if (connectionLost(e)) {
        if (slot.conn === conn) await this.forget(slot);
        this.lost(slot, e);
        const err = this.wrap(e, slot.holdsLocks ? 'lostLocks' : 'lost', request);
        (err as any).rfcLost = true;
        throw err;
      }
      if (conn.closed || closesConnection(e)) {
        // An ABAP message or a short dump: the request reached SAP and failed
        // there, and the SDK closed the connection with it. Report the SAP
        // error itself; the next request opens a new connection.
        if (slot.conn === conn) await this.forget(slot);
        if (slot.holdsLocks) this.lost(slot, e);
        const err = this.wrap(e, 'call', request);
        if (slot.holdsLocks) err.message += '. The RFC session ended with this error: locks held in the RFC session are gone; lock the objects again before writing.';
        throw err;
      }
      throw this.wrap(e, 'call', request);
    }
  }

  /** Reset after a write. The write itself succeeded, so a failing reset only drops the connection. */
  private async resetQuietly(slot: Slot): Promise<void> {
    const conn = slot.conn;
    if (!conn) return;
    try {
      await conn.reset();
    } catch (e) {
      await this.forget(slot);
      if (connectionLost(e)) this.lost(slot, e);
    }
  }

  private exception(message: string, code: string | undefined, status: number | undefined, request: HttpClientOptions, cause?: unknown): HttpClientException {
    // HttpClientException survives abap-adt-api's error mapping with its
    // message, status and code intact (a plain Error becomes a 500).
    const HttpClientExceptionClass = httpClientExceptionClass();
    const err = new HttpClientExceptionClass(message, code, status, undefined, request, undefined, cause);
    if (cause !== undefined) (err as any).cause = cause;
    return err;
  }

  private wrap(e: unknown, phase: 'open' | 'call' | 'lost' | 'lostLocks', request: HttpClientOptions): HttpClientException {
    const dest = this.options.destination;
    const msg = (e as any)?.message ? String((e as any).message) : String(e);
    if (!isRfcError(e)) {
      return this.exception(phase === 'open' ? `RFC connection to ${dest} could not be opened: ${msg}` : `RFC call to ${dest} failed: ${msg}`, undefined, undefined, request, e);
    }
    const code = e.rfcCodeName;
    // Binding-level failures (SDK not found, wrong version) carry install instructions.
    if (e.rfcCode === -1) return this.exception(msg, code, undefined, request, e);
    if (phase === 'open' && logonFailure(e)) return this.exception(`RFC logon to ${dest} failed: ${msg}`, code, 401, request, e);
    if (phase === 'open') return this.exception(`RFC connection to ${dest} could not be opened (${code}): ${msg}`, code, undefined, request, e);
    if (phase === 'lostLocks') {
      return this.exception(`RFC connection to ${dest} lost (${code}): ${msg}. The RFC session ended: locks held in the RFC session are gone; lock the objects again before writing. The server reconnects on the next call.`, code, undefined, request, e);
    }
    if (phase === 'lost') {
      return this.exception(`RFC connection to ${dest} lost (${code}): ${msg}. The server reconnects on the next call; if this was a write, read the object before repeating it.`, code, undefined, request, e);
    }
    // A short dump in the RFC server (RFC_ABAP_RUNTIME_FAILURE) is SAP's 500.
    const status = e.rfcCode === RFC_RC.RFC_ABAP_RUNTIME_FAILURE ? 500 : undefined;
    return this.exception(`RFC call to ${dest} failed (${code}): ${msg}`, code, status, request, e);
  }
}

/** Loader of the NW RFC SDK binding, shared per process and per SDK folder; the binding module is imported on first use only. */
const connectorCache = new Map<string, Promise<RfcConnector>>();

export function nwRfcConnector(sdkPath?: string): () => Promise<RfcConnector> {
  return () => {
    const key = sdkPath || '';
    let p = connectorCache.get(key);
    if (!p) {
      p = import('./nwrfc.js').then(m => m.loadNwRfcConnector(sdkPath));
      connectorCache.set(key, p);
      // A failed load (SDK not installed yet) is retried on the next request.
      p.catch(() => { if (connectorCache.get(key) === p) connectorCache.delete(key); });
    }
    return p;
  };
}

/** NW RFC SDK logon parameters of a destination; a MYSAPSSO2 ticket for sso/sso2 comes from setLogonOverride. */
export function rfcLogonParams(sys: Pick<SystemConfig, 'client' | 'language' | 'authType' | 'user' | 'password' | 'rfc'>): RfcLogonParams {
  const rfc = sys.rfc || {};
  const p: RfcLogonParams = {};
  if (rfc.ashost) {
    p.ASHOST = rfc.ashost;
    if (rfc.sysnr) p.SYSNR = rfc.sysnr;
  } else {
    if (rfc.mshost) p.MSHOST = rfc.mshost;
    if (rfc.sysid) p.SYSID = rfc.sysid;
    p.GROUP = rfc.group || 'PUBLIC';
    if (rfc.msserv) p.MSSERV = rfc.msserv;
  }
  if (rfc.saprouter) p.SAPROUTER = rfc.saprouter;
  if (rfc.gwhost) p.GWHOST = rfc.gwhost;
  if (rfc.gwserv) p.GWSERV = rfc.gwserv;
  if (sys.client) p.CLIENT = sys.client;
  p.LANG = sys.language || 'EN';
  if (sys.authType === 'basic') {
    if (sys.user) p.USER = sys.user;
    if (sys.password) p.PASSWD = sys.password;
  }
  return p;
}

/** The MYSAPSSO2 logon ticket among harvested cookies, URL-decoded when the cookie carries it encoded. */
export function logonTicketOf(cookies: Array<{ name: string; value: string }>): string | undefined {
  const raw = cookies.find(c => c.name.toUpperCase() === 'MYSAPSSO2')?.value;
  if (!raw) return undefined;
  if (!raw.includes('%')) return raw;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

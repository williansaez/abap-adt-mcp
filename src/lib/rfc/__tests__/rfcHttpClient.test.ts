/**
 * RFC transport adapter with a fake RfcConnector/RfcConnection (no SDK):
 * routing, session resets, logoff/dropSession, CSRF, header and URI shaping,
 * response mapping, connection loss, logon failure and serialization; then
 * the wiring in the server (config -> RfcHttpClient -> ADTClient).
 */
import { RfcHttpClient, buildUri, buildHeaders, toHttpResponse, deriveStatus, isLockRequest, rfcLogonParams, logonTicketOf, nwRfcConnector } from '../rfcHttpClient';
import { RFC_RC, RfcConnection, RfcConnector, RfcError, RfcLogonParams, SadtRequest, SadtResponse } from '../types';

jest.mock('puppeteer-core', () => ({}));
jest.mock('../../browserLogin', () => ({ browserLogin: jest.fn() }));
const mockLoader = { connector: undefined as unknown, loads: 0, fail: false };
jest.mock('../nwrfc', () => ({
  loadNwRfcConnector: jest.fn(async () => {
    mockLoader.loads++;
    if (mockLoader.fail) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RfcError: E } = require('../types');
      throw new E('SAP NW RFC SDK not found: set SAPNWRFC_HOME', -1, 'SDK_NOT_FOUND');
    }
    return mockLoader.connector;
  }),
}));

type Handler = (req: SadtRequest, conn: FakeConnection) => Promise<SadtResponse>;

const ok = (body = '', statusCode = '200', headers: Array<[string, string]> = [], reasonPhrase = 'OK'): SadtResponse => ({
  version: 'HTTP/1.1', statusCode, reasonPhrase, headers: headers.map(([name, value]) => ({ name, value })), body: Buffer.from(body, 'utf8'),
});

class FakeConnection implements RfcConnection {
  calls: SadtRequest[] = [];
  resets = 0;
  closed = false;
  closeCount = 0;
  resetError?: unknown;
  constructor(readonly id: number, readonly params: RfcLogonParams, private handler: Handler) {}
  async callAdt(req: SadtRequest): Promise<SadtResponse> {
    this.calls.push(req);
    return this.handler(req, this);
  }
  async reset(): Promise<void> {
    this.resets++;
    if (this.resetError) throw this.resetError;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.closeCount++;
  }
}

class FakeConnector implements RfcConnector {
  readonly sdkVersion = '7.50.17';
  readonly libraryPath = '/fake/lib/libsapnwrfc.dylib';
  opened: FakeConnection[] = [];
  openError?: unknown;
  constructor(public handler: Handler = async () => ok('<ok/>')) {}
  async open(params: RfcLogonParams): Promise<RfcConnection> {
    if (this.openError) throw this.openError;
    const c = new FakeConnection(this.opened.length, { ...params }, (req, conn) => this.handler(req, conn));
    this.opened.push(c);
    return c;
  }
}

const basicParams: RfcLogonParams = { ASHOST: 'h', SYSNR: '00', CLIENT: '100', LANG: 'EN', USER: 'DEV', PASSWD: 'pw' };

function makeClient(connector: FakeConnector, extra: Partial<ConstructorParameters<typeof RfcHttpClient>[0]> = {}) {
  return new RfcHttpClient({
    destination: 'DEV',
    connector: async () => connector,
    logonParams: async () => ({ ...basicParams }),
    sessions: 'split',
    ...extra,
  });
}

const GET = (url: string, more: Record<string, any> = {}) => ({ url, method: 'GET' as const, headers: { Accept: '*/*', 'X-sap-adt-sessiontype': 'stateful' }, ...more });
const lockReq = (action: 'LOCK' | 'UNLOCK') => ({ url: '/sap/bc/adt/programs/programs/zx', method: 'POST' as const, headers: { 'X-sap-adt-sessiontype': '' }, qs: { _action: action, accessMode: 'MODIFY' } });

describe('RfcHttpClient', () => {
  it('routes LOCK and UNLOCK to the enqueue connection on _action, not on the session header', async () => {
    const connector = new FakeConnector();
    const client = makeClient(connector);
    await client.request(GET('/sap/bc/adt/programs/programs/zx/source/main'));
    await client.request(lockReq('LOCK'));
    await client.request({ url: '/sap/bc/adt/programs/programs/zx?_action=UNLOCK&lockHandle=abc', method: 'POST', headers: { 'X-sap-adt-sessiontype': 'stateful' } });
    // keep mode sends an empty session type; still the work connection
    await client.request({ url: '/sap/bc/adt/programs/programs/zx/source/main', method: 'GET', headers: { 'X-sap-adt-sessiontype': '' } });
    const [work, enqueue] = connector.opened;
    expect(connector.opened).toHaveLength(2);
    expect(enqueue.calls.map(c => c.uri)).toEqual([
      '/sap/bc/adt/programs/programs/zx?_action=LOCK&accessMode=MODIFY',
      '/sap/bc/adt/programs/programs/zx?_action=UNLOCK&lockHandle=abc',
    ]);
    expect(work.calls).toHaveLength(2);
    expect(isLockRequest('/x', { _action: 'unlock' })).toBe(true);
    expect(isLockRequest('/x', { _action: 'CHECK' })).toBe(false);
  });

  it('resets the work connection after writes in split mode, never in single mode', async () => {
    const connector = new FakeConnector();
    const client = makeClient(connector);
    await client.request(GET('/sap/bc/adt/oo/classes/zcl_x/source/main'));
    const work = connector.opened[0];
    expect(work.resets).toBe(0);
    await client.request({ url: '/sap/bc/adt/oo/classes/zcl_x/source/main', method: 'PUT', headers: {}, qs: { lockHandle: 'h' }, body: 'CLASS zcl_x.' });
    expect(work.resets).toBe(1);
    await client.request({ url: '/sap/bc/adt/activation', method: 'POST', headers: {}, body: '<x/>' });
    await client.request({ url: '/sap/bc/adt/oo/classes/zcl_x', method: 'DELETE', headers: {} });
    expect(work.resets).toBe(3);
    await client.request(lockReq('LOCK'));
    expect(connector.opened[1].resets).toBe(0);

    const single = new FakeConnector();
    const one = makeClient(single, { sessions: 'single' });
    await one.request(lockReq('LOCK'));
    await one.request({ url: '/sap/bc/adt/oo/classes/zcl_x/source/main', method: 'PUT', headers: {}, body: 'x' });
    await one.request(GET('/sap/bc/adt/oo/classes/zcl_x/source/main'));
    expect(single.opened).toHaveLength(1);
    expect(single.opened[0].resets).toBe(0);
    expect(single.opened[0].calls).toHaveLength(3);
  });

  it('answers logoff itself and closes both connections, which reopen on the next request', async () => {
    const connector = new FakeConnector();
    const client = makeClient(connector);
    await client.request(GET('/sap/bc/adt/discovery'));
    await client.request(lockReq('LOCK'));
    const res = await client.request({ url: '/sap/public/bc/icf/logoff', headers: {} });
    expect(res).toMatchObject({ status: 200, body: '' });
    expect(res.headers['x-csrf-token']).toBe('rfc');
    expect(connector.opened.map(c => c.closed)).toEqual([true, true]);
    expect(connector.opened.flatMap(c => c.calls).some(c => /logoff/.test(c.uri))).toBe(false);
    await client.request(GET('/sap/bc/adt/discovery'));
    expect(connector.opened).toHaveLength(3);
  });

  it('treats the bare stateless graph GET of dropSession as the end of the stateful session', async () => {
    const connector = new FakeConnector();
    const client = makeClient(connector);
    await client.request(GET('/sap/bc/adt/discovery'));
    await client.request(lockReq('LOCK'));
    const [work, enqueue] = connector.opened;
    // login: same path, but with sap-client: no reset
    await client.request({ url: '/sap/bc/adt/compatibility/graph', headers: { 'X-sap-adt-sessiontype': 'stateless' }, qs: { 'sap-client': '100' } });
    // a stateful graph GET: no reset
    await client.request(GET('/sap/bc/adt/compatibility/graph'));
    expect(enqueue.resets).toBe(0);
    await client.request({ url: '/sap/bc/adt/compatibility/graph', headers: { 'X-sap-adt-sessiontype': 'stateless' } });
    expect(enqueue.resets).toBe(1);
    expect(work.calls.map(c => c.uri)).toEqual(['/sap/bc/adt/discovery', '/sap/bc/adt/compatibility/graph', '/sap/bc/adt/compatibility/graph', '/sap/bc/adt/compatibility/graph']);
    // explicit API: endStatefulSession resets, close() closes
    await client.endStatefulSession();
    expect(enqueue.resets).toBe(2);
    await client.close();
    expect(work.closed && enqueue.closed).toBe(true);
    // a session whose reset fails is closed instead
    await client.request(lockReq('LOCK'));
    const enqueue2 = connector.opened[2];
    enqueue2.resetError = new RfcError('gone', RFC_RC.RFC_COMMUNICATION_FAILURE, 'RFC_COMMUNICATION_FAILURE');
    await expect(client.endStatefulSession()).resolves.toBeUndefined();
    expect(enqueue2.closed).toBe(true);
  });

  it('never forwards CSRF, cookies, auth or the session header; adds a synthetic token and a default Accept', async () => {
    const connector = new FakeConnector(async () => ok('<x/>', '200', [['x-csrf-token', 'Required']]));
    const client = makeClient(connector);
    const res = await client.request({
      url: '/sap/bc/adt/x', method: 'POST', body: 'b',
      headers: {
        Cookie: 'SAP_SESSIONID=s', authorization: 'Basic x', 'x-csrf-token': 'fetch', 'X-sap-adt-sessiontype': 'stateful',
        'Accept-Encoding': 'gzip', 'Content-Length': '1', Host: 'h', 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache',
      } as any,
    });
    expect(res.headers['x-csrf-token']).toBe('rfc');
    expect(connector.opened[0].calls[0].headers).toEqual([
      { name: 'Content-Type', value: 'text/plain' }, { name: 'Cache-Control', value: 'no-cache' }, { name: 'Accept', value: '*/*' },
    ]);
    expect(buildHeaders({ Accept: '*/*', accept: 'application/xml' })).toEqual([{ name: 'accept', value: 'application/xml' }]);
    expect(buildHeaders({ Accept: '' })).toEqual([{ name: 'Accept', value: '*/*' }]);
  });

  it('builds the URI from the path and the merged, encoded query without sap-client and sap-language', () => {
    expect(buildUri('/sap/bc/adt/oo/classes/zcl_x/source/main', {
      lockHandle: 'a+b/c= d', 'sap-client': '100', 'sap-language': 'EN', corrNr: undefined, ids: ['1', '2'], n: 3,
    })).toBe('/sap/bc/adt/oo/classes/zcl_x/source/main?lockHandle=a%2Bb%2Fc%3D%20d&ids=1&ids=2&n=3');
    expect(buildUri('https://sap.example.com:44300/sap/bc/adt/y?sap-client=100&a=1%2B2', { b: '2' })).toBe('/sap/bc/adt/y?a=1%2B2&b=2');
    expect(buildUri('sap/bc/adt/z')).toBe('/sap/bc/adt/z');
    expect(buildUri('/sap/bc/adt/z', { 'SAP-CLIENT': '100' })).toBe('/sap/bc/adt/z');
  });

  it('sends HEAD as GET and returns an empty body; sends the body as UTF-8 bytes', async () => {
    const connector = new FakeConnector(async () => ok('<big/>', '200', [['content-type', 'text/xml']]));
    const client = makeClient(connector);
    const res = await client.request({ url: '/sap/bc/adt/x', method: 'HEAD', headers: {} });
    expect(connector.opened[0].calls[0]).toMatchObject({ method: 'GET', version: 'HTTP/1.1' });
    expect(res).toMatchObject({ status: 200, body: '' });
    await client.request({ url: '/sap/bc/adt/x', method: 'PUT', headers: {}, body: 'ação' });
    expect(connector.opened[0].calls[1].body.equals(Buffer.from('ação', 'utf8'))).toBe(true);
    await client.request({ url: '/sap/bc/adt/x', method: 'GET', headers: {} });
    expect(connector.opened[0].calls[2].body.length).toBe(0);
  });

  it('parses STATUS_CODE with blanks and derives it from the body when an old release leaves it empty', () => {
    expect(toHttpResponse(ok('x', '200 ')).status).toBe(200);
    expect(toHttpResponse(ok('', '404', [], 'Not Found'))).toMatchObject({ status: 404, statusText: 'Not Found' });
    const exc = (type: string) => `<?xml version="1.0"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="${type}"/><message lang="EN">m</message></exc:exception>`;
    expect(toHttpResponse(ok(exc('ExceptionResourceNotFound'), '', [], ''))).toMatchObject({ status: 404, statusText: 'Not Found' });
    expect(toHttpResponse(ok(exc('ExceptionResourceInvalidLockHandle'), ' ')).status).toBe(423);
    expect(toHttpResponse(ok(exc('ExceptionResourceNoAccess'), '')).status).toBe(403);
    expect(toHttpResponse(ok(exc('ExceptionResourceLocked'), '')).status).toBe(403);
    expect(toHttpResponse(ok(exc('ExceptionNotAuthorized'), '')).status).toBe(403);
    expect(toHttpResponse(ok(exc('ExceptionResourceAlreadyExists'), '')).status).toBe(409);
    expect(toHttpResponse(ok(exc('ExceptionSomethingElse'), '')).status).toBe(400);
    expect(toHttpResponse(ok('<ok/>', '', [], '')).status).toBe(200);
    expect(deriveStatus('plain')).toBe(200);
  });

  it('maps response headers to lower-case names, skips ~ pseudo headers and keeps repeats as arrays', () => {
    const res = toHttpResponse(ok('', '200', [['~server_protocol', 'HTTP/1.1'], ['Content-Type', 'text/plain'], ['X-Multi', 'a'], ['x-multi', 'b'], ['set-cookie', 'a=b']]));
    expect(res.headers).toEqual({ 'content-type': 'text/plain', 'x-multi': ['a', 'b'], 'set-cookie': ['a=b'], 'x-csrf-token': 'rfc' });
  });

  it('decodes binary content types as latin1 and everything else as UTF-8', () => {
    const bin: SadtResponse = { ...ok(), headers: [{ name: 'Content-Type', value: 'application/zip' }], body: Buffer.from([0x50, 0x4b, 0xff, 0xfe]) };
    const body = toHttpResponse(bin).body;
    expect(Buffer.from(body, 'latin1').equals(Buffer.from([0x50, 0x4b, 0xff, 0xfe]))).toBe(true);
    expect(toHttpResponse({ ...ok('Descrição'), headers: [{ name: 'content-type', value: 'text/plain; charset=utf-8' }] }).body).toBe('Descrição');
    expect(toHttpResponse({ ...ok(), headers: [{ name: 'content-type', value: 'image/png' }], body: Buffer.from([0xc3]) }).body).toBe('Ã');
  });

  it('reconnects after a lost connection and reports lost locks only for the enqueue connection', async () => {
    const lost = () => new RfcError('partner not reached', RFC_RC.RFC_COMMUNICATION_FAILURE, 'RFC_COMMUNICATION_FAILURE');
    let failNext = false;
    const connector = new FakeConnector(async () => {
      if (failNext) { failNext = false; throw lost(); }
      return ok('<ok/>');
    });
    const onSessionLost = jest.fn();
    const client = makeClient(connector, { onSessionLost });
    await client.request(GET('/sap/bc/adt/discovery'));
    failNext = true;
    const err: any = await client.request({ url: '/sap/bc/adt/x', method: 'POST', headers: {} }).catch(e => e);
    expect(err.message).toMatch(/^RFC connection to DEV lost \(RFC_COMMUNICATION_FAILURE\): partner not reached/);
    expect(err.cause).toBeInstanceOf(RfcError);
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(connector.opened[0].closed).toBe(true);
    await client.request(GET('/sap/bc/adt/discovery'));
    expect(connector.opened).toHaveLength(2);

    await client.request(lockReq('LOCK'));
    failNext = true;
    const lockErr: any = await client.request(lockReq('LOCK')).catch(e => e);
    expect(lockErr.message).toMatch(/RFC connection to DEV lost .*locks held in the RFC session are gone/);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(onSessionLost.mock.calls[0][0]).toMatch(/locks held in the RFC session are gone/);
    await client.request(lockReq('LOCK'));
    expect(connector.opened).toHaveLength(4);

    // a connection the SDK reports as closed between calls is replaced too
    connector.opened[3].closed = true;
    await client.request(lockReq('UNLOCK'));
    expect(connector.opened).toHaveLength(5);
    expect(onSessionLost).toHaveBeenCalledTimes(2);
  });

  it('repeats a read once when an idle connection turns out to be gone, never a write', async () => {
    let failNext = false;
    const connector = new FakeConnector(async () => {
      if (failNext) { failNext = false; throw new RfcError('connection closed', RFC_RC.RFC_CLOSED, 'RFC_CLOSED'); }
      return ok('<ok/>');
    });
    const client = makeClient(connector);
    await client.request(GET('/sap/bc/adt/discovery'));
    failNext = true;
    await expect(client.request(GET('/sap/bc/adt/discovery'))).resolves.toMatchObject({ status: 200 });
    expect(connector.opened).toHaveLength(2);
    failNext = true;
    await expect(client.request({ url: '/sap/bc/adt/x', method: 'PUT', headers: {}, body: 'x' })).rejects.toThrow(/lost/);
  });

  it('refuses a wrong password once, then makes no further logon attempt until login or a restart', async () => {
    const connector = new FakeConnector();
    let attempts = 0;
    const realOpen = connector.open.bind(connector);
    connector.open = async (params) => { attempts++; return realOpen(params); };
    connector.openError = new RfcError('Name or password is incorrect (repeat logon)', RFC_RC.RFC_LOGON_FAILURE, 'RFC_LOGON_FAILURE');
    const client = makeClient(connector);
    const err: any = await client.request(GET('/sap/bc/adt/discovery')).catch(e => e);
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/^RFC logon to DEV was refused: Name or password is incorrect \(repeat logon\)\. The server makes no further logon attempt/);
    // further calls, reads and lock requests alike, never reach SAP
    const again: any = await client.request(GET('/sap/bc/adt/discovery')).catch(e => e);
    await client.request({ url: '/sap/bc/adt/programs/programs/zx', method: 'POST', headers: {}, qs: { _action: 'LOCK' } }).catch(() => undefined);
    expect(attempts).toBe(1);
    expect(again.message).toMatch(/No new logon was attempted/);
    // an explicit login allows exactly one new attempt
    client.allowLogonAgain();
    connector.openError = undefined;
    await expect(client.request(GET('/sap/bc/adt/discovery'))).resolves.toMatchObject({ status: 200 });
    expect(attempts).toBe(2);
  });

  it('turns a refused ticket logon into a 401 the library and the server treat as an expired session', async () => {
    const connector = new FakeConnector();
    connector.openError = new RfcError('Name or password is incorrect (repeat logon)', RFC_RC.RFC_LOGON_FAILURE, 'RFC_LOGON_FAILURE');
    const client = makeClient(connector);
    await client.setLogonOverride({ MYSAPSSO2: 'ticket-value' });
    const err: any = await client.request(GET('/sap/bc/adt/discovery')).catch(e => e);
    expect(err).toMatchObject({ status: 401, message: 'RFC logon to DEV failed: Name or password is incorrect (repeat logon)' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fromException, isLoginError } = require('abap-adt-api/build/AdtException');
    const adtErr = fromException(err);
    expect(isLoginError(adtErr)).toBe(true);
    expect(adtErr.message).toBe(err.message);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { classifyAdtError } = require('../../adtErrorHints');
    expect(classifyAdtError(adtErr).kind).toBe('sessionExpired');

    // no user and no ticket: 401 before the SDK is asked
    const noUser = new FakeConnector();
    const sso = makeClient(noUser, { logonParams: async () => ({ ASHOST: 'h', SYSNR: '00', CLIENT: '100', LANG: 'EN' }) });
    await expect(sso.request(GET('/x'))).rejects.toMatchObject({ status: 401 });
    expect(noUser.opened).toHaveLength(0);
    await sso.setLogonOverride({ MYSAPSSO2: 'ticket' });
    await sso.request(GET('/x'));
    expect(noUser.opened[0].params).toMatchObject({ MYSAPSSO2: 'ticket', CLIENT: '100' });
  });

  it('surfaces binding failures unchanged and other RFC errors with the destination name', async () => {
    const client = makeClient(new FakeConnector(), {
      connector: async () => { throw new RfcError('SAP NW RFC SDK not found in /usr/local/sap/nwrfcsdk: install it and set SAPNWRFC_HOME', -1, 'SDK_NOT_FOUND'); },
    });
    const err: any = await client.request(GET('/x')).catch(e => e);
    expect(err.message).toBe('SAP NW RFC SDK not found in /usr/local/sap/nwrfcsdk: install it and set SAPNWRFC_HOME');
    expect(err.code).toBe('SDK_NOT_FOUND');

    const unreachable = new FakeConnector();
    unreachable.openError = new RfcError('partner h:3300 not reached', RFC_RC.RFC_COMMUNICATION_FAILURE, 'RFC_COMMUNICATION_FAILURE');
    await expect(makeClient(unreachable).request(GET('/x'))).rejects.toThrow(/^RFC connection to DEV could not be opened \(RFC_COMMUNICATION_FAILURE\)/);

    const dump = new FakeConnector(async () => { throw new RfcError('SYSTEM_FAILURE', RFC_RC.RFC_ABAP_RUNTIME_FAILURE, 'RFC_ABAP_RUNTIME_FAILURE'); });
    const dumpClient = makeClient(dump);
    await expect(dumpClient.request(GET('/x'))).rejects.toMatchObject({ status: 500, message: 'RFC call to DEV failed (RFC_ABAP_RUNTIME_FAILURE): SYSTEM_FAILURE' });
    // The SDK closes the connection after a short dump; the next request opens a new one.
    expect(dump.opened[0].closed).toBe(true);
    dump.handler = async () => ok('<ok/>');
    await expect(dumpClient.request(GET('/x'))).resolves.toMatchObject({ status: 200 });
    expect(dump.opened).toHaveLength(2);
  });

  it('drops the lock session when an ABAP error closes it, and keeps the work session error plain', async () => {
    const lost: string[] = [];
    const connector = new FakeConnector(async (req) => {
      if (/_action=LOCK/.test(req.uri)) throw new RfcError('Object locked by user X', RFC_RC.RFC_ABAP_MESSAGE, 'RFC_ABAP_MESSAGE');
      throw new RfcError('Division by zero', RFC_RC.RFC_ABAP_RUNTIME_FAILURE, 'RFC_ABAP_RUNTIME_FAILURE');
    });
    const client = new RfcHttpClient({ destination: 'DEV', connector: async () => connector, logonParams: async () => ({ USER: 'U', PASSWD: 'p' }), sessions: 'split', onSessionLost: (r) => lost.push(r) });
    const lockErr: any = await client.request({ url: '/sap/bc/adt/programs/programs/zx', method: 'POST', headers: {}, qs: { _action: 'LOCK', accessMode: 'MODIFY' } }).catch(e => e);
    expect(lockErr.message).toMatch(/^RFC call to DEV failed \(RFC_ABAP_MESSAGE\): Object locked by user X\. The RFC session ended with this error: locks held in the RFC session are gone/);
    expect(lost).toHaveLength(1);
    const workErr: any = await client.request(GET('/x')).catch(e => e);
    expect(workErr.status).toBe(500);
    expect(workErr.message).not.toMatch(/locks held/);
    expect(lost).toHaveLength(1);
  });

  it('keeps a write successful when the reset after it fails, and drops that connection', async () => {
    const connector = new FakeConnector();
    const client = makeClient(connector);
    await client.request(GET('/x'));
    connector.opened[0].resetError = new RfcError('boom', RFC_RC.RFC_ABAP_RUNTIME_FAILURE, 'RFC_ABAP_RUNTIME_FAILURE');
    await expect(client.request({ url: '/x', method: 'PUT', headers: {}, body: 'x' })).resolves.toMatchObject({ status: 200 });
    expect(connector.opened[0].closed).toBe(true);
    await client.request(GET('/x'));
    expect(connector.opened).toHaveLength(2);
  });

  it('serializes calls on one connection and opens it once for concurrent first requests', async () => {
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const connector = new FakeConnector(async (req) => {
      order.push(`start ${req.uri}`);
      await new Promise<void>(resolve => gates.push(resolve));
      order.push(`end ${req.uri}`);
      return ok('<ok/>');
    });
    const client = makeClient(connector);
    const a = client.request(GET('/a'));
    const b = client.request(GET('/b'));
    const lock = client.request(lockReq('LOCK'));
    for (let i = 0; i < 20 && gates.length < 2; i++) await new Promise(r => setImmediate(r));
    // /a on work and the lock on enqueue run side by side; /b waits for /a
    expect(order).toEqual(expect.arrayContaining(['start /a', 'start /sap/bc/adt/programs/programs/zx?_action=LOCK&accessMode=MODIFY']));
    expect(order).not.toContain('start /b');
    gates.shift()!();
    gates.shift()!();
    for (let i = 0; i < 20 && gates.length < 1; i++) await new Promise(r => setImmediate(r));
    expect(order.indexOf('start /b')).toBeGreaterThan(order.indexOf('end /a'));
    gates.shift()!();
    await Promise.all([a, b, lock]);
    expect(connector.opened).toHaveLength(2);
  });

  it('works under abap-adt-api: login, lock, write, unlock, dropSession and logout', async () => {
    const lockXml = '<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><LOCK_HANDLE>A+B/C=</LOCK_HANDLE><CORRNR/><CORRUSER/><CORRTEXT/><IS_LOCAL>X</IS_LOCAL><IS_LINK_UP/><MODIFICATION_SUPPORT>NoModification</MODIFICATION_SUPPORT></DATA></asx:values></asx:abap>';
    const connector = new FakeConnector(async (req) => /_action=LOCK/.test(req.uri) ? ok(lockXml, '200', [['content-type', 'application/vnd.sap.as+xml']]) : ok(''));
    const client = makeClient(connector);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ADTClient, session_types } = require('abap-adt-api');
    const adt = new ADTClient(client, 'DEV', '', '100', 'EN');
    adt.stateful = session_types.stateful;
    await adt.login();
    const lock = await adt.lock('/sap/bc/adt/programs/programs/zx');
    expect(lock.LOCK_HANDLE).toBe('A+B/C=');
    await adt.setObjectSource('/sap/bc/adt/programs/programs/zx/source/main', 'REPORT zx.', lock.LOCK_HANDLE);
    await adt.unLock('/sap/bc/adt/programs/programs/zx', lock.LOCK_HANDLE);
    const [work, enqueue] = connector.opened;
    expect(work.calls[0].uri).toBe('/sap/bc/adt/compatibility/graph');
    expect(work.calls[1]).toMatchObject({ method: 'PUT', uri: '/sap/bc/adt/programs/programs/zx/source/main?lockHandle=A%2BB%2FC%3D' });
    expect(work.resets).toBe(1);
    expect(enqueue.calls.map(c => c.uri)).toEqual([
      '/sap/bc/adt/programs/programs/zx?_action=LOCK&accessMode=MODIFY',
      // the library pre-encodes the handle of UNLOCK; HTTP clients encode it again too
      '/sap/bc/adt/programs/programs/zx?_action=UNLOCK&lockHandle=A%252BB%252FC%253D',
    ]);
    await adt.dropSession();
    expect(enqueue.resets).toBe(1);
    await adt.logout();
    expect(work.closed && enqueue.closed).toBe(true);
  });
});

describe('RFC helpers', () => {
  it('builds SDK logon parameters for direct and message server logon', () => {
    expect(rfcLogonParams({ authType: 'basic', user: 'DEV', password: 'pw', client: '100', language: 'DE', rfc: { ashost: 'h', sysnr: '00', saprouter: '/H/r/S/3299', gwhost: 'g', gwserv: 'sapgw00' } }))
      .toEqual({ ASHOST: 'h', SYSNR: '00', SAPROUTER: '/H/r/S/3299', GWHOST: 'g', GWSERV: 'sapgw00', CLIENT: '100', LANG: 'DE', USER: 'DEV', PASSWD: 'pw' });
    expect(rfcLogonParams({ authType: 'sso', user: 'IGNORED', client: '200', rfc: { mshost: 'ms', sysid: 'OLD', msserv: '3600' } }))
      .toEqual({ MSHOST: 'ms', SYSID: 'OLD', GROUP: 'PUBLIC', MSSERV: '3600', CLIENT: '200', LANG: 'EN' });
    expect(rfcLogonParams({ authType: 'sso2', client: '200', rfc: { mshost: 'ms', sysid: 'OLD', group: 'DEV' } }).GROUP).toBe('DEV');
  });

  it('finds the MYSAPSSO2 ticket and decodes it when the cookie carries it encoded', () => {
    expect(logonTicketOf([{ name: 'SAP_SESSIONID_OLD_100', value: 's' }, { name: 'MYSAPSSO2', value: 'AjQx%2Bab%3D' }])).toBe('AjQx+ab=');
    expect(logonTicketOf([{ name: 'mysapsso2', value: 'AjQx+ab=' }])).toBe('AjQx+ab=');
    expect(logonTicketOf([{ name: 'SAP_SESSIONID_OLD_100', value: 's' }])).toBeUndefined();
  });

  it('loads the SDK binding lazily, once per SDK folder, and retries after a failed load', async () => {
    const connector = new FakeConnector();
    mockLoader.connector = connector;
    mockLoader.loads = 0;
    const load = nwRfcConnector('/opt/sdk-a');
    expect(mockLoader.loads).toBe(0);
    expect(await load()).toBe(connector);
    expect(await nwRfcConnector('/opt/sdk-a')()).toBe(connector);
    expect(mockLoader.loads).toBe(1);
    mockLoader.fail = true;
    await expect(nwRfcConnector('/opt/sdk-b')()).rejects.toMatchObject({ rfcCodeName: 'SDK_NOT_FOUND' });
    mockLoader.fail = false;
    expect(await nwRfcConnector('/opt/sdk-b')()).toBe(connector);
    expect(mockLoader.loads).toBe(3);
  });
});

describe('server wiring of transport rfc', () => {
  let AbapAdtServer: any;
  let browserLogin: jest.Mock;
  let errorSpy: jest.SpyInstance;
  const text = (r: any) => JSON.parse(r.content[0].text);
  // The binding is loaded once per process and SDK folder: one fake for all servers here.
  const connector = new FakeConnector();

  beforeAll(() => {
    process.env.SAP_SYSTEMS = JSON.stringify({
      OLD: { url: 'https://old.example.com:44300', client: '100', authType: 'basic', user: 'DEV', password: 'pw', transport: 'rfc', rfc: { ashost: 'old.example.com', sysnr: '00' } },
      OLDSSO: { url: 'https://oldsso.example.com', client: '200', authType: 'sso', transport: 'rfc', rfc: { mshost: 'ms.example.com', sysid: 'OLD', sessions: 'single' } },
      NEW: { url: 'https://new.example.com', client: '100', authType: 'basic', user: 'u', password: 'p' },
    });
    process.env.SAP_DEFAULT_DESTINATION = 'OLD';
    delete process.env.MCP_TOOLSETS;
    delete process.env.MCP_DISABLED_TOOLSETS;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AbapAdtServer = require('../../../index').AbapAdtServer;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    browserLogin = require('../../browserLogin').browserLogin;
    mockLoader.connector = connector;
  });
  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());

  it('lists the transport and a secret-free RFC summary', async () => {
    const server = new AbapAdtServer();
    const systems = text(await server.dispatch('listSystems', {}, () => undefined)).systems;
    expect(systems.find((s: any) => s.destination === 'OLD')).toMatchObject({ transport: 'rfc', rfc: { ashost: 'old.example.com', sysnr: '00', sessions: 'split' } });
    expect(systems.find((s: any) => s.destination === 'OLDSSO').rfc).toEqual({ mshost: 'ms.example.com', sysid: 'OLD', sessions: 'single' });
    expect(systems.find((s: any) => s.destination === 'NEW').transport).toBeUndefined();
    expect(JSON.stringify(systems)).not.toContain('"pw"');
    expect(server.getDestination('NEW').rfcClient).toBeUndefined();
  });

  it('logs on with user and password over RFC and releases everything on close', async () => {
    const start = connector.opened.length;
    const server = new AbapAdtServer();
    const dest = server.getDestination('OLD');
    expect(dest.rfcClient).toBeDefined();
    expect(dest.cookieClient).toBeUndefined();
    await dest.adtClient.login();
    expect(connector.opened[start].params).toEqual({ ASHOST: 'old.example.com', SYSNR: '00', CLIENT: '100', LANG: 'EN', USER: 'DEV', PASSWD: 'pw' });
    await dest.adtClient.lock('/sap/bc/adt/programs/programs/zx').catch(() => undefined);
    expect(connector.opened.length - start).toBe(2);
    await server.close();
    expect(connector.opened.slice(start).every(c => c.closed)).toBe(true);
  });

  it('hands the MYSAPSSO2 ticket of the browser login to the RFC logon, or explains why there is none', async () => {
    const start = connector.opened.length;
    const server = new AbapAdtServer();
    browserLogin.mockResolvedValueOnce([{ name: 'SAP_SESSIONID_OLD_200', value: 's' }, { name: 'MYSAPSSO2', value: 'AjQx%2Bt%3D' }]);
    await server.ensureLogin('OLDSSO', false);
    expect(browserLogin).toHaveBeenCalledWith('https://oldsso.example.com', '200');
    expect(connector.opened[start].params).toEqual({ MSHOST: 'ms.example.com', SYSID: 'OLD', GROUP: 'PUBLIC', CLIENT: '200', LANG: 'EN', MYSAPSSO2: 'AjQx+t=' });

    const other = new AbapAdtServer();
    browserLogin.mockResolvedValueOnce([{ name: 'SAP_SESSIONID_OLD_200', value: 's' }]);
    await expect(other.ensureLogin('OLDSSO', false)).rejects.toThrow(/yielded no logon ticket .*login\/create_sso2_ticket.*authType basic/);
  });

  it('forgets the lock ledger when the RFC session that held the locks is lost', async () => {
    const server = new AbapAdtServer();
    const dest = server.getDestination('OLD');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordLock, listLocks } = require('../../lockLedger');
    recordLock(dest.adtClient, '/sap/bc/adt/programs/programs/zx', 'h');
    (dest.rfcClient as any).options.onSessionLost('RFC session of OLD ended (RFC_COMMUNICATION_FAILURE): locks held in the RFC session are gone');
    expect(listLocks(dest.adtClient)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('locks held in the RFC session are gone'));
  });
});

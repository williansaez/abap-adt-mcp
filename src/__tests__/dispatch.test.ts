/**
 * Dispatcher behaviour with stubbed handlers: protocol errors, policy gate,
 * toolset refusal, per-destination serialization, platform gate modes and the
 * one-shot re-authentication retry.
 */
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

jest.mock('puppeteer-core', () => ({}));
jest.mock('../lib/sso2TicketProvider', () => ({
  getSso2Cookies: jest.fn(async () => [{ name: 'MYSAPSSO2', value: 'temporary-ticket' }]),
}));
process.env.SAP_SYSTEMS = JSON.stringify({
  DEV: { url: 'https://example.invalid', authType: 'basic', user: 'u', password: 'p', client: '100' },
  RO: { url: 'https://ro.invalid', authType: 'basic', user: 'u', password: 'p', client: '100', policy: { readOnly: true, allowedPackages: ['Z*'] } },
});
process.env.SAP_DEFAULT_DESTINATION = 'DEV';
process.env.MCP_TOOLSETS = 'source,objects,data';
delete process.env.MCP_DISABLED_TOOLSETS;
delete process.env.MCP_PROFILE_GATE;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AbapAdtServer } = require('../index');

const text = (r: any) => JSON.parse(r.content[0].text);

function stub(server: any, destination: string, handlerKey: string, impl: (name: string, args: any) => Promise<any>) {
  const dest = server.getDestination(destination);
  dest.handlers[handlerKey].handle = jest.fn(impl);
  return dest;
}

describe('dispatch', () => {
  let server: any;
  beforeEach(() => { server = new AbapAdtServer(); });

  it('answers listSystems/healthcheck without SAP and rejects unknown destinations and tools as protocol errors', async () => {
    expect(text(await server.dispatch('healthcheck', {}, () => undefined))).toMatchObject({ status: 'healthy', default: 'DEV' });
    await expect(server.dispatch('getObjectSource', { destination: 'NOPE' }, () => undefined)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(server.dispatch('noSuchTool', {}, () => undefined)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    await expect(server.dispatch('debuggerListen', {}, () => undefined)).rejects.toThrow(/toolset "debugger"/);
  });

  it('uses the opt-in SSO2 provider without opening a browser or affecting existing destinations', async () => {
    const ticketProvider = require('../lib/sso2TicketProvider').getSso2Cookies;
    server.systems.set('TICKET', {
      name: 'TICKET', url: 'https://ticket.invalid', client: '100', authType: 'sso2',
      sso2: { command: '/usr/bin/provider', args: ['--system', 'QAS'], timeoutMs: 30_000 },
    });
    const dest = server.getDestination('TICKET');
    dest.adtClient.login = jest.fn(async () => undefined);

    await server.ensureLogin('TICKET', false);

    expect(ticketProvider).toHaveBeenCalledWith(server.systems.get('TICKET').sso2);
    expect(dest.adtClient.login).toHaveBeenCalledTimes(1);
    expect([...dest.cookieClient.jar.entries()]).toEqual([['MYSAPSSO2', 'temporary-ticket']]);
    expect(server.getDestination('DEV').system.authType).toBe('basic');
  });

  it('applies the destination policy before calling the handler', async () => {
    const dest = stub(server, 'RO', 'objectSource', async () => ({ ok: true }));
    await expect(server.dispatch('setObjectSource', { destination: 'RO', objectSourceUrl: '/sap/bc/adt/oo/classes/zcl_x/source/main', source: 'x' }, () => undefined))
      .rejects.toThrow(/Policy: setObjectSource blocked .*readOnly/);
    expect(dest.handlers.objectSource.handle).not.toHaveBeenCalled();
    // exportPackageSources only writes locally and stays allowed on read-only destinations.
    stub(server, 'RO', 'navigation', async () => ({ exported: true }));
    expect(text(await server.dispatch('exportPackageSources', { destination: 'RO', packageName: 'ZX', targetDir: '/tmp/x' }, () => undefined))).toEqual({ exported: true });
  });

  it('refuses table data on a destination without a policy and shows the effective data access in listSystems', async () => {
    const dest = stub(server, 'DEV', 'query', async () => ({ rows: [] }));
    await expect(server.dispatch('tableContents', { destination: 'DEV', ddicEntityName: 'T000' }, () => undefined))
      .rejects.toThrow(/Policy: tableContents blocked on destination DEV \(allowDataPreview\)/);
    await expect(server.dispatch('runQuery', { destination: 'DEV', sqlQuery: 'select * from t000' }, () => undefined))
      .rejects.toThrow(/Policy: runQuery blocked on destination DEV \(allowFreeSql\)/);
    expect(dest.handlers.query.handle).not.toHaveBeenCalled();
    const listed = text(await server.dispatch('listSystems', {}, () => undefined)).systems;
    for (const s of listed) expect(s.dataAccess).toEqual({ allowDataPreview: false, allowFreeSql: false });

    server.systems.get('DEV').policy = { allowDataPreview: true };
    expect(text(await server.dispatch('tableContents', { destination: 'DEV', ddicEntityName: 'T000' }, () => undefined))).toEqual({ rows: [] });
    expect(text(await server.dispatch('listSystems', {}, () => undefined)).systems.find((s: any) => s.destination === 'DEV').dataAccess)
      .toEqual({ allowDataPreview: true, allowFreeSql: false });
  });

  it('serializes calls per destination in arrival order', async () => {
    const order: string[] = [];
    stub(server, 'DEV', 'objectSource', async (name, args) => {
      order.push(`start ${args.n}`);
      await new Promise(r => setTimeout(r, args.n === 1 ? 30 : 1));
      order.push(`end ${args.n}`);
      return { n: args.n };
    });
    const [a, b] = await Promise.all([
      server.dispatch('getObjectSource', { n: 1 }, () => undefined),
      server.dispatch('getObjectSource', { n: 2 }, () => undefined),
    ]);
    expect([text(a).n, text(b).n]).toEqual([1, 2]);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('does not re-authenticate on a wrapped ordinary error whose text mentions saml', async () => {
    stub(server, 'DEV', 'objectSource', async () => {
      const cause: any = new Error('Object ZCL_SAML_HANDLER not found'); cause.status = 404;
      throw Object.assign(new McpError(ErrorCode.InternalError, 'Failed to get object source: Object ZCL_SAML_HANDLER not found'), { cause });
    });
    server.reauthenticate = jest.fn(async () => undefined);
    const onRetry = jest.fn();
    await expect(server.dispatch('getObjectSource', { objectSourceUrl: '/x' }, onRetry)).rejects.toThrow(/not found/);
    expect(onRetry).not.toHaveBeenCalled();
    expect(server.reauthenticate).not.toHaveBeenCalled();
  });

  it('re-authenticates and retries once on an expired session, and gives up on the second failure', async () => {
    let calls = 0;
    stub(server, 'DEV', 'objectSource', async () => {
      calls++;
      if (calls === 1) { const e: any = new Error('Request failed with status code 401'); e.status = 401; throw e; }
      return { source: 'after retry' };
    });
    server.reauthenticate = jest.fn(async () => undefined);
    const onRetry = jest.fn();
    expect(text(await server.dispatch('getObjectSource', { objectSourceUrl: '/x' }, onRetry))).toEqual({ source: 'after retry' });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(server.reauthenticate).toHaveBeenCalledWith('DEV');

    calls = 0;
    stub(server, 'DEV', 'objectSource', async () => { const e: any = new Error('Request failed with status code 401'); e.status = 401; throw e; });
    await expect(server.dispatch('getObjectSource', { objectSourceUrl: '/x' }, onRetry)).rejects.toThrow(/401/);
  });

  it('builds the profile on the first call of a gated toolset and honours MCP_PROFILE_GATE', async () => {
    process.env.MCP_TOOLSETS = 'source,objects,debugger';
    server = new AbapAdtServer();
    const profile = { platform: 'cloud', unavailableTools: ['debuggerListen'], unavailableToolsets: ['debugger'] };
    server.getProfile = jest.fn(async (name: string) => { server.getDestination(name).profile = Promise.resolve(profile); return profile; });
    const dest = stub(server, 'DEV', 'debug', async () => ({ listened: true }));
    await expect(server.dispatch('debuggerListen', {}, () => undefined)).rejects.toThrow(/not available on destination DEV/);
    expect(server.getProfile).toHaveBeenCalledTimes(1);
    expect(dest.handlers.debug.handle).not.toHaveBeenCalled();

    process.env.MCP_PROFILE_GATE = 'warn';
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(text(await server.dispatch('debuggerListen', {}, () => undefined))).toEqual({ listened: true });
    expect(err.mock.calls.some(c => /not available on destination DEV/.test(String(c[0])))).toBe(true);
    err.mockRestore();

    process.env.MCP_PROFILE_GATE = 'off';
    expect(text(await server.dispatch('debuggerListen', {}, () => undefined))).toEqual({ listened: true });
    delete process.env.MCP_PROFILE_GATE;
    process.env.MCP_TOOLSETS = 'source,objects,data';
  });

  it('resolves the package from the repository node path when the transport check cannot be parsed', async () => {
    const dest = server.getDestination('DEV');
    dest.loggedIn = true;
    dest.adtClient.transportInfo = jest.fn(async () => { throw new TypeError("Cannot read properties of undefined (reading 'asx:values')"); });
    dest.adtClient.findObjectPath = jest.fn(async () => [
      { 'adtcore:type': 'DEVC/K', 'adtcore:name': '$TMP' },
      { 'adtcore:type': 'PROG/P', 'adtcore:name': 'ZMCP_TEST_HELLO' },
    ]);
    expect(await server.resolvePackage('DEV', '/sap/bc/adt/programs/programs/zmcp_test_hello/source/main')).toBe('$TMP');
    expect(dest.adtClient.findObjectPath).toHaveBeenCalledWith('/sap/bc/adt/programs/programs/zmcp_test_hello');
    expect(dest.packageCache.get('/sap/bc/adt/programs/programs/zmcp_test_hello')).toBe('$TMP');

    dest.packageCache.clear();
    dest.adtClient.findObjectPath = jest.fn(async () => { throw new Error('404'); });
    expect(await server.resolvePackage('DEV', '/sap/bc/adt/programs/programs/zmcp_test_hello')).toBeUndefined();

    // Every error abap-adt-api raises itself keeps the 2.7 behaviour: no second request.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { adtException } = require('abap-adt-api');
    for (const make of [
      () => adtException('Not authorized', 403),
      () => adtException('Object ZX is locked in request DEVK900001 of user OTHER', 0),
    ]) {
      dest.packageCache.clear();
      dest.adtClient.transportInfo = jest.fn(async () => { throw make(); });
      dest.adtClient.findObjectPath = jest.fn(async () => [{ 'adtcore:type': 'DEVC/K', 'adtcore:name': 'ZPKG' }]);
      expect(await server.resolvePackage('DEV', '/sap/bc/adt/programs/programs/zmcp_test_hello')).toBeUndefined();
      expect(dest.adtClient.findObjectPath).not.toHaveBeenCalled();
    }

    // Over HTTP a 404 of the transport check still means "package unknown" ...
    dest.packageCache.clear();
    dest.adtClient.transportInfo = jest.fn(async () => { throw adtException('Not Found', 404); });
    dest.adtClient.findObjectPath = jest.fn(async () => [{ 'adtcore:type': 'DEVC/K', 'adtcore:name': '$TMP' }]);
    expect(await server.resolvePackage('DEV', '/sap/bc/adt/programs/programs/zmcp_test_hello')).toBeUndefined();
    expect(dest.adtClient.findObjectPath).not.toHaveBeenCalled();
    // ... while on an RFC destination it means the check does not exist on that release (7.40)
    dest.packageCache.clear();
    dest.rfcClient = {} as any;
    expect(await server.resolvePackage('DEV', '/sap/bc/adt/programs/programs/zmcp_test_hello')).toBe('$TMP');
    expect(dest.adtClient.findObjectPath).toHaveBeenCalledTimes(1);
    delete dest.rfcClient;
  });

  it('forgets the package memo after objects are created, deleted, renamed or moved', async () => {
    const dest = stub(server, 'DEV', 'objectDeletion', async () => ({ deleted: true }));
    dest.packageCache.set('/sap/bc/adt/oo/classes/zcl_x', 'ZOLD');
    await server.dispatch('deleteObject', { objectUrl: '/sap/bc/adt/oo/classes/zcl_x' }, () => undefined);
    expect(dest.packageCache.size).toBe(0);
  });

  it('close() releases recorded locks and drops the SAP session of every pooled destination', async () => {
    const dest = server.getDestination('DEV');
    const { recordLock, listLocks } = require('../lib/lockLedger');
    dest.adtClient.unLock = jest.fn(async () => undefined);
    dest.adtClient.dropSession = jest.fn(async () => undefined);
    Object.defineProperty(dest.adtClient, 'loggedin', { value: true, configurable: true });
    recordLock(dest.adtClient, '/sap/bc/adt/oo/classes/zcl_x', 'H');
    await server.close();
    expect(dest.adtClient.unLock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_x', 'H');
    expect(dest.adtClient.dropSession).toHaveBeenCalled();
    expect(listLocks(dest.adtClient)).toHaveLength(0);
  });

  it('maps guessed parameter names onto the tool schema before calling the handler', async () => {
    const dest = stub(server, 'DEV', 'objectSource', async (_n, args) => ({ got: args }));
    const r = text(await server.dispatch('getObjectSource', { objectUrl: '/sap/bc/adt/oo/classes/zcl_x/source/main', MaxLines: 5 }, () => undefined));
    expect(r.got).toEqual({ objectSourceUrl: '/sap/bc/adt/oo/classes/zcl_x/source/main', maxLines: 5 });
    expect(dest.handlers.objectSource.handle).toHaveBeenCalledTimes(1);
  });
});

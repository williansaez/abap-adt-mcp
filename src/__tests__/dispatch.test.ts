/**
 * Dispatcher behaviour with stubbed handlers: protocol errors, policy gate,
 * toolset refusal, per-destination serialization, platform gate modes and the
 * one-shot re-authentication retry.
 */
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

jest.mock('puppeteer-core', () => ({}));
process.env.SAP_SYSTEMS = JSON.stringify({
  DEV: { url: 'https://example.invalid', authType: 'basic', user: 'u', password: 'p', client: '100' },
  RO: { url: 'https://ro.invalid', authType: 'basic', user: 'u', password: 'p', client: '100', policy: { readOnly: true, allowedPackages: ['Z*'] } },
});
process.env.SAP_DEFAULT_DESTINATION = 'DEV';
process.env.MCP_TOOLSETS = 'source,objects';
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

  it('applies the destination policy before calling the handler', async () => {
    const dest = stub(server, 'RO', 'objectSource', async () => ({ ok: true }));
    await expect(server.dispatch('setObjectSource', { destination: 'RO', objectSourceUrl: '/sap/bc/adt/oo/classes/zcl_x/source/main', source: 'x' }, () => undefined))
      .rejects.toThrow(/Policy: setObjectSource blocked .*readOnly/);
    expect(dest.handlers.objectSource.handle).not.toHaveBeenCalled();
    // exportPackageSources only writes locally and stays allowed on read-only destinations.
    stub(server, 'RO', 'navigation', async () => ({ exported: true }));
    expect(text(await server.dispatch('exportPackageSources', { destination: 'RO', packageName: 'ZX', targetDir: '/tmp/x' }, () => undefined))).toEqual({ exported: true });
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
    process.env.MCP_TOOLSETS = 'source,objects';
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
});

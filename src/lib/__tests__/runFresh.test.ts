import { runClassFresh, runClassWhenReady } from '../runFresh';
import { recordLock, listLocks } from '../lockLedger';

describe('runClassFresh', () => {
  it('uses the stateless clone when the client can be cloned, leaving locks alone', async () => {
    const clone = { runClass: jest.fn(async () => 'fresh') };
    const client: any = { stateful: 'stateful', runClass: jest.fn(async () => 'stale'), statelessClone: clone, unLock: jest.fn() };
    recordLock(client, '/sap/bc/adt/oo/classes/zcl_a', 'H1');
    const r = await runClassFresh(client, 'ZCL_A');
    expect(r).toEqual({ output: 'fresh', mode: 'clone', locksInvalidated: [] });
    expect(client.runClass).not.toHaveBeenCalled();
    expect(client.stateful).toBe('stateful');
    expect(listLocks(client)).toHaveLength(1);
  });

  it('falls back to a stateless request on SSO clients, releasing and reporting recorded locks', async () => {
    const client: any = {
      stateful: 'stateful',
      runClass: jest.fn(async function (this: any) { return `ran ${client.stateful}`; }),
      unLock: jest.fn(async () => undefined),
      get statelessClone() { throw new Error('Not logged in'); },
    };
    recordLock(client, '/sap/bc/adt/oo/classes/zcl_b', 'H2');
    const r = await runClassFresh(client, 'ZCL_B');
    expect(r).toEqual({ output: 'ran stateless', mode: 'stateless', locksInvalidated: ['/sap/bc/adt/oo/classes/zcl_b'] });
    expect(client.unLock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_b', 'H2');
    expect(listLocks(client)).toHaveLength(0);
    expect(client.stateful).toBe('stateful');
  });
});

describe('runClassWhenReady', () => {
  const NOT_READY = 'Error: Class does not implement if_oo_adt_classrun~main method!';
  const noSleep = jest.fn(async () => undefined);

  it('retries while the runner does not see the activated class yet', async () => {
    const outputs = [NOT_READY, NOT_READY, 'hello'];
    const client: any = { stateful: 'stateless', runClass: jest.fn(async () => outputs.shift()) };
    const r = await runClassWhenReady(client, 'ZCL_A', [10, 20, 40], noSleep);
    expect(r).toMatchObject({ output: 'hello', attempts: 3, notReady: false });
    expect(noSleep).toHaveBeenCalledTimes(2);
  });

  it('runs once when the first answer is real output', async () => {
    const client: any = { stateful: 'stateless', runClass: jest.fn(async () => 'hello') };
    expect(await runClassWhenReady(client, 'ZCL_A', [10], noSleep)).toMatchObject({ attempts: 1, notReady: false });
  });

  it('reports notReady when every attempt got the not-ready answer', async () => {
    const client: any = { stateful: 'stateless', runClass: jest.fn(async () => NOT_READY) };
    const r = await runClassWhenReady(client, 'ZCL_A', [10, 20], noSleep);
    expect(r).toMatchObject({ attempts: 3, notReady: true });
  });
});

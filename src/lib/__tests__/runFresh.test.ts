import { runClassFresh } from '../runFresh';
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

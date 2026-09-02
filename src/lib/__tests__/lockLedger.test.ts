import { withLock, recordLock, findLock, listLocks, releaseAll, clearLedger, objectNameFromUrl } from '../lockLedger';

function client(opts: { lockFails?: boolean; unlockFails?: boolean } = {}) {
  let n = 0;
  const c: any = {
    stateful: 'stateless',
    lock: jest.fn(async () => { if (opts.lockFails) throw new Error('locked by OTHER'); return { LOCK_HANDLE: `H${++n}` }; }),
    unLock: jest.fn(async () => { if (opts.unlockFails) throw new Error('unlock boom'); }),
  };
  return c;
}
const URL = '/sap/bc/adt/oo/classes/zcl_demo/source/main';

describe('lock ledger', () => {
  it('auto mode locks, runs, unlocks and leaves no entry', async () => {
    const c = client();
    const r = await withLock(c, URL, undefined, async (h) => `wrote with ${h}`);
    expect(r).toEqual({ result: 'wrote with H1', lockHandle: 'H1', lockMode: 'auto', unlockError: undefined });
    expect(c.lock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo', undefined);
    expect(c.unLock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo', 'H1');
    expect(listLocks(c)).toEqual([]);
    expect(c.stateful).toBe('stateful');
  });

  it('unlocks and rethrows when the write fails', async () => {
    const c = client();
    await expect(withLock(c, URL, undefined, async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    expect(c.unLock).toHaveBeenCalledTimes(1);
    expect(listLocks(c)).toEqual([]);
  });

  it('reports an unlock failure instead of swallowing it', async () => {
    const c = client({ unlockFails: true });
    const r = await withLock(c, URL, undefined, async () => 1);
    expect(r.unlockError).toMatch(/unlock boom/);
    expect(listLocks(c)).toEqual([]);
  });

  it('reuses a recorded explicit lock and keeps it', async () => {
    const c = client();
    recordLock(c, '/sap/bc/adt/oo/classes/zcl_demo', 'EXPL', 'MODIFY', false);
    const r = await withLock(c, URL, undefined, async (h) => h);
    expect(r).toMatchObject({ result: 'EXPL', lockMode: 'reused' });
    expect(c.lock).not.toHaveBeenCalled();
    expect(c.unLock).not.toHaveBeenCalled();
    expect(findLock(c, URL)?.lockHandle).toBe('EXPL');
  });

  it('passes an explicit handle straight through', async () => {
    const c = client();
    const r = await withLock(c, URL, 'GIVEN', async (h) => h);
    expect(r).toMatchObject({ result: 'GIVEN', lockMode: 'explicit' });
    expect(c.lock).not.toHaveBeenCalled();
  });

  it('keepOnSuccess skips the unlock (deleted objects) but still unlocks on failure', async () => {
    const c = client();
    await withLock(c, URL, undefined, async () => 'deleted', { keepOnSuccess: true });
    expect(c.unLock).not.toHaveBeenCalled();
    expect(listLocks(c)).toEqual([]);
  });

  it('propagates lock failures', async () => {
    const c = client({ lockFails: true });
    await expect(withLock(c, URL, undefined, async () => 1)).rejects.toThrow(/locked by OTHER/);
  });

  it('releaseAll unlocks every entry and reports failures; clearLedger forgets silently', async () => {
    const c = client({ unlockFails: true });
    recordLock(c, '/a', 'H1'); recordLock(c, '/b', 'H2');
    const r = await releaseAll(c);
    expect(r.released).toEqual([]);
    expect(r.failed.map(f => f.objectUrl)).toEqual(['/a', '/b']);
    expect(listLocks(c)).toEqual([]);
    recordLock(c, '/c', 'H3');
    clearLedger(c);
    expect(listLocks(c)).toEqual([]);
  });

  it('derives the object name for activation', () => {
    expect(objectNameFromUrl(URL)).toBe('ZCL_DEMO');
    expect(objectNameFromUrl('/sap/bc/adt/programs/programs/zreport')).toBe('ZREPORT');
  });
});

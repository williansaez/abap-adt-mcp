import { session_types } from 'abap-adt-api';
import { createOutsideStatefulContext } from '../createFresh';
import { recordLock, clearLedger } from '../lockLedger';

function client() {
  const c: any = { stateful: session_types.stateful, seen: [] as string[] };
  c.create = jest.fn(async () => { c.seen.push(c.stateful); return 'made'; });
  return c;
}

describe('createOutsideStatefulContext', () => {
  it('sends the creation as a stateless request when no lock is held, and restores the session type', async () => {
    const c = client();
    const r = await createOutsideStatefulContext(c, () => c.create());
    expect(c.seen).toEqual([session_types.stateless]);
    expect(c.stateful).toBe(session_types.stateful);
    expect(r).toEqual({ result: 'made', context: 'stateless', locksHeld: [] });
  });

  it('restores the session type when the creation fails', async () => {
    const c = client();
    c.create = jest.fn(async () => { throw new Error('nope'); });
    await expect(createOutsideStatefulContext(c, () => c.create())).rejects.toThrow('nope');
    expect(c.stateful).toBe(session_types.stateful);
  });

  it('keeps the stateful session when locks are held, and says what that means for the new object', async () => {
    const c = client();
    recordLock(c, '/sap/bc/adt/oo/classes/zcl_a', 'H1');
    recordLock(c, '/sap/bc/adt/programs/programs/zprog', 'H2', undefined, true);
    try {
      const r = await createOutsideStatefulContext(c, () => c.create());
      expect(c.seen).toEqual([session_types.stateful]);
      expect(r.context).toBe('stateful');
      expect(r.locksHeld).toEqual(['/sap/bc/adt/oo/classes/zcl_a', '/sap/bc/adt/programs/programs/zprog']);
      expect(r.note).toMatch(/2 lock\(s\) are held/);
      expect(r.note).toMatch(/setObjectSource/);
      expect(r.note).toMatch(/400/);
    } finally { clearLedger(c); }
  });

  it('leaves a client that was stateless as it was', async () => {
    const c = client();
    c.stateful = session_types.stateless;
    await createOutsideStatefulContext(c, () => c.create());
    expect(c.seen).toEqual([session_types.stateless]);
    expect(c.stateful).toBe(session_types.stateless);
  });
});

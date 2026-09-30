import { session_types } from 'abap-adt-api';
import { ObjectRegistrationHandlers } from '../ObjectRegistrationHandlers';
import { recordLock, clearLedger } from '../../lib/lockLedger';

function make() {
  const client: any = { stateful: session_types.stateful, seen: [] as string[] };
  client.createObject = jest.fn(async () => { client.seen.push(client.stateful); });
  return { client, handler: new ObjectRegistrationHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);
const CLASS = { objtype: 'CLAS/OC', name: 'ZCL_DEMO', parentName: 'ZPKG', description: 'Demo', parentPath: '/sap/bc/adt/packages/zpkg' };

describe('createObject and the stateful session', () => {
  it('creates outside the stateful context when no lock is held, so the object can be read at once', async () => {
    const { client, handler } = make();
    const res = parse(await handler.handle('createObject', CLASS));
    expect(client.seen).toEqual([session_types.stateless]);
    expect(client.stateful).toBe(session_types.stateful);
    expect(res).toMatchObject({ status: 'success', context: 'stateless' });
    expect(res.note).toBeUndefined();
  });

  it('keeps the stateful context when locks are held, and warns that the object is unreadable until written', async () => {
    const { client, handler } = make();
    recordLock(client, '/sap/bc/adt/oo/classes/zcl_other', 'H');
    try {
      const res = parse(await handler.handle('createObject', CLASS));
      expect(client.seen).toEqual([session_types.stateful]);
      expect(res).toMatchObject({ status: 'success', context: 'stateful', locksHeld: ['/sap/bc/adt/oo/classes/zcl_other'] });
      expect(res.note).toMatch(/setObjectSource/);
    } finally { clearLedger(client); }
  });
});

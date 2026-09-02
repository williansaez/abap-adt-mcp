import { TransportHandlers } from '../TransportHandlers';

const URL = '/sap/bc/adt/oo/classes/zcl_demo';
function makeHandler(info: any, created = 'DEVK900123') {
  const client: any = {
    transportInfo: jest.fn(async () => info),
    createTransport: jest.fn(async () => created)
  };
  return { client, handler: new TransportHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);
const tr = (TRKORR: string, AS4DATE: string, AS4TIME = '000000', TRSTATUS = 'D') => ({ TRKORR, TRSTATUS, AS4DATE, AS4TIME, AS4USER: 'DEV', AS4TEXT: 'x', TARSYSTEM: 'QAS', TRFUNCTION: 'K', CLIENT: '100' });

describe('resolveTransport', () => {
  it('uses the transport that already locks the object', async () => {
    const { handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', LOCKS: { HEADER: tr('DEVK900001', '20260101'), TASKS: [tr('DEVK900002', '20260101')] }, TRANSPORTS: [tr('DEVK900050', '20260201')] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL }));
    expect(res).toMatchObject({ transport: 'DEVK900001', needsTransport: true, tasks: ['DEVK900002'] });
    expect(res.reason).toMatch(/transport lock/);
  });

  it('returns null for local packages', async () => {
    const { handler } = makeHandler({ DEVCLASS: '$TMP', RECORDING: '', DLVUNIT: 'LOCAL', TRANSPORTS: [] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL }));
    expect(res).toMatchObject({ transport: null, needsTransport: false });
  });

  it('picks the newest modifiable candidate and skips released ones', async () => {
    const { handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', TRANSPORTS: [tr('DEVK900010', '20260101'), tr('DEVK900020', '20260301', '120000'), tr('DEVK900030', '20260401', '000000', 'R')] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL }));
    expect(res.transport).toBe('DEVK900020');
    expect(res.candidates.map((c: any) => c.transport)).toEqual(['DEVK900020', 'DEVK900010']);
  });

  it('honours preferTransport when it is a modifiable candidate', async () => {
    const { handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', TRANSPORTS: [tr('DEVK900010', '20260101'), tr('DEVK900020', '20260301')] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL, preferTransport: 'devk900010' }));
    expect(res.transport).toBe('DEVK900010');
  });

  it('reports needsTransport without creating when nothing is modifiable', async () => {
    const { client, handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', TRANSPORTS: [] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL }));
    expect(res).toMatchObject({ transport: null, needsTransport: true });
    expect(res.reason).toMatch(/createIfMissing/);
    expect(client.createTransport).not.toHaveBeenCalled();
  });

  it('creates a transport on request', async () => {
    const { client, handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', TRANSPORTS: [] });
    const res = parse(await handler.handle('resolveTransport', { objSourceUrl: URL, createIfMissing: true, requestText: 'feature X' }));
    expect(client.createTransport).toHaveBeenCalledWith(URL, 'feature X', 'ZPKG');
    expect(res).toMatchObject({ transport: 'DEVK900123', created: true, needsTransport: true });
  });

  it('surfaces SAP error messages instead of guessing', async () => {
    const { handler } = makeHandler({ DEVCLASS: 'ZPKG', RECORDING: 'X', DLVUNIT: 'HOME', TRANSPORTS: [], MESSAGES: [{ SEVERITY: 'E', TEXT: 'Package ZPKG does not exist' }] });
    await expect(handler.handle('resolveTransport', { objSourceUrl: URL })).rejects.toThrow(/Package ZPKG does not exist/);
  });
});

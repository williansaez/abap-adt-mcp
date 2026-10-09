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

describe('transportUnifiedDiff targets', () => {
  const resolve = (TransportHandlers as any).resolveDiffTarget as (p: string, t: string, n: string) => any;
  it('maps LIMU class parts onto the class and its include', () => {
    expect(resolve('LIMU', 'CINC', 'ZBP_R_EXAMPLE_HEAD==CCIMP')).toMatchObject({ searchName: 'ZBP_R_EXAMPLE_HEAD', searchType: 'CLAS', include: 'implementations' });
    expect(resolve('LIMU', 'CINC', 'ZCL_A                         CCAU')).toMatchObject({ searchName: 'ZCL_A', include: 'testclasses' });
    expect(resolve('LIMU', 'METH', 'ZCL_A                         GET_DATA')).toMatchObject({ searchName: 'ZCL_A', include: 'main' });
    expect(resolve('LIMU', 'CPUB', 'ZCL_A')).toMatchObject({ searchName: 'ZCL_A', searchType: 'CLAS' });
    expect(resolve('LIMU', 'REPS', 'ZINCLUDE_TOP')).toMatchObject({ searchName: 'ZINCLUDE_TOP' });
    expect(resolve('LIMU', 'FUNC', 'Z_FM')).toMatchObject({ searchName: 'Z_FM', searchType: 'FUGR/FF' });
  });
  it('explains what cannot be diffed', () => {
    expect(resolve('LIMU', 'MESS', 'ZMSG000').skip).toMatch(/messageclass/);
    expect(resolve('R3TR', 'TABL', 'ZTAB').skip).toMatch(/not a source object/);
    expect(resolve('R3TR', 'CLAS', 'ZCL_A')).toMatchObject({ searchName: 'ZCL_A', searchType: 'CLAS' });
    expect(resolve('LIMU', 'CINC', 'ZCL_A==XXXX').skip).toMatch(/not a diffable include/);
  });
});

describe('userTransports and transportDetails on SAP_BASIS 7.40', () => {
  const TREE = `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:workbench tm:category="Workbench"><tm:modifiable tm:status="D">` +
    `<tm:request tm:number="P03K901865" tm:owner="MLS_BC" tm:desc="TESTE" tm:status="D"><tm:task tm:number="P03K901866" tm:owner="MLS_BC" tm:desc="TESTE" tm:status="D"/></tm:request>` +
    `</tm:modifiable></tm:workbench></tm:root>`;
  function make740() {
    const client: any = {
      // What abap-adt-api returns for that tree: nothing.
      userTransports: jest.fn(async () => ({ workbench: [], customizing: [] })),
      transportDetails: jest.fn(async () => ({ links: [], objects: [], tasks: [] })),
      httpClient: { request: jest.fn(async () => ({ body: TREE, status: 200, headers: {} })) }
    };
    return { client, handler: new TransportHandlers(client) };
  }

  it('lists the requests from the tree without tm:target', async () => {
    const { client, handler } = make740();
    const text = JSON.stringify(parse(await handler.handle('userTransports', { user: 'MLS_BC' })));
    expect(text).toContain('P03K901865');
    expect(client.httpClient.request).toHaveBeenCalledWith('/sap/bc/adt/cts/transportrequests', { qs: { user: 'MLS_BC', targets: true } });
  });

  it('finds the request in the tree, and says so when it is not the user\'s', async () => {
    const { handler } = make740();
    expect(parse(await handler.handle('transportDetails', { transportNumber: 'P03K901865' })).details).toMatchObject({ 'tm:number': 'P03K901865', tasks: [{ 'tm:number': 'P03K901866' }] });
    await expect(handler.handle('transportDetails', { transportNumber: 'P03K000001' })).rejects.toThrow(/not among the requests of the logged-on user/);
  });

  it('keeps the library answer on newer releases', async () => {
    const client: any = { transportDetails: jest.fn(async () => ({ 'tm:number': 'DEVK900001', links: [], objects: [], tasks: [] })), httpClient: { request: jest.fn() } };
    const handler = new TransportHandlers(client);
    expect(parse(await handler.handle('transportDetails', { transportNumber: 'DEVK900001' })).details['tm:number']).toBe('DEVK900001');
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });
});

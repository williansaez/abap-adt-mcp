import { adtException } from 'abap-adt-api/build/AdtException';
import { TextElementHandlers, textElementsBaseUrl } from '../TextElementHandlers';

// The shape abap-adt-api throws for a 404 with an ADT exception or empty body: err=404, no status.
const notFound = () => adtException('Error 404:Not Found', 404);

function makeHandler(opts: { probe?: () => Promise<any>; set?: () => Promise<void> } = {}) {
  const client: any = {
    stateful: undefined,
    httpClient: { request: jest.fn(opts.probe ?? (async () => ({ body: '001=Hello\n', status: 200, headers: {} }))) },
    getTextElements: jest.fn(async () => ({ textElements: [{ id: '001', text: 'Hello' }], programName: 'zdemo' })),
    setTextElements: jest.fn(opts.set ?? (async () => undefined))
  };
  return { client, handler: new TextElementHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);
const SET_ARGS = { objectUrl: '/sap/bc/adt/programs/programs/zdemo', category: 'symbols', elements: '[{"id":"001","text":"Hello"}]', lockHandle: 'H' };

describe('textElementsBaseUrl', () => {
  it('maps object URLs to the text element resources, never to the object source', () => {
    expect(textElementsBaseUrl('/sap/bc/adt/programs/programs/zdemo')).toBe('/sap/bc/adt/textelements/programs/zdemo');
    expect(textElementsBaseUrl('/sap/bc/adt/programs/programs/zdemo/source/main')).toBe('/sap/bc/adt/textelements/programs/zdemo');
    expect(textElementsBaseUrl('/sap/bc/adt/oo/classes/ZCL_DEMO')).toBe('/sap/bc/adt/textelements/classes/zcl_demo');
    expect(textElementsBaseUrl('/sap/bc/adt/functions/groups/zfg')).toBe('/sap/bc/adt/textelements/functiongroups/zfg');
    expect(textElementsBaseUrl('/sap/bc/adt/programs/programs/%2fns%2fzrep')).toBe('/sap/bc/adt/textelements/programs/%2Fns%2Fzrep');
    expect(textElementsBaseUrl('/sap/bc/adt/textelements/programs/zdemo')).toBe('/sap/bc/adt/textelements/programs/zdemo');
  });

  it('refuses objects that have no text elements', () => {
    expect(() => textElementsBaseUrl('/sap/bc/adt/oo/interfaces/zif_demo')).toThrow(/programs, classes and function groups/);
    expect(() => textElementsBaseUrl('')).toThrow(/programs, classes and function groups/);
  });
});

describe('setTextElements', () => {
  it('writes to the text element resource, not to the program', async () => {
    // On P03 (SAP_BASIS 7.40) a PUT to .../programs/programs/<name>/source/symbols replaced the program code.
    const { client, handler } = makeHandler();
    expect(parse(await handler.handle('setTextElements', SET_ARGS))).toMatchObject({ updated: true, url: '/sap/bc/adt/textelements/programs/zdemo' });
    expect(client.setTextElements).toHaveBeenCalledWith('/sap/bc/adt/textelements/programs/zdemo', 'symbols', [{ id: '001', text: 'Hello' }], 'H', undefined);
  });

  it('explains a 404 (no text element resources, e.g. SAP_BASIS 7.40)', async () => {
    const { handler } = makeHandler({ set: async () => { throw notFound(); } });
    await expect(handler.handle('setTextElements', SET_ARGS)).rejects.toThrow(/not available here.*Nothing was written/);
  });

  it('passes other errors through unchanged', async () => {
    const { handler } = makeHandler({ set: async () => { throw adtException('Object is locked', 403); } });
    await expect(handler.handle('setTextElements', SET_ARGS)).rejects.toThrow(/Failed to set text elements: .*locked/);
  });
});

describe('getTextElements', () => {
  it('reads the text element resource', async () => {
    const { client, handler } = makeHandler();
    const r = parse(await handler.handle('getTextElements', { objectUrl: '/sap/bc/adt/oo/classes/zcl_demo' }));
    expect(r.textElements).toHaveLength(1);
    expect(client.httpClient.request.mock.calls[0][0]).toBe('/sap/bc/adt/textelements/classes/zcl_demo/source/symbols');
    expect(client.getTextElements).toHaveBeenCalledWith('/sap/bc/adt/textelements/classes/zcl_demo', 'symbols');
  });

  it('says why the list is empty when SAP answers 404', async () => {
    const { client, handler } = makeHandler({ probe: async () => { throw notFound(); } });
    const r = parse(await handler.handle('getTextElements', { objectUrl: '/sap/bc/adt/programs/programs/zdemo', category: 'selections' }));
    expect(r.textElements).toEqual([]);
    expect(r.note).toMatch(/404.*SAP_BASIS 7.40/);
    expect(client.getTextElements).not.toHaveBeenCalled();
  });

  it('does not hide other probe errors', async () => {
    const { handler } = makeHandler({ probe: async () => { throw adtException('Internal error', 500); } });
    await expect(handler.handle('getTextElements', { objectUrl: '/sap/bc/adt/programs/programs/zdemo' })).rejects.toThrow(/Failed to get text elements/);
  });
});

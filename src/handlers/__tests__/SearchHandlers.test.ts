import { SearchHandlers } from '../SearchHandlers';
import { parseTextSearchResponse, grepSource, buildPattern, mapLimit } from '../../lib/textSearch';
import { sourceCache } from '../../lib/sourceCache';

// sourceCache is process-wide: isolate tests from each other.
beforeEach(() => sourceCache.clear());

const XML = `<?xml version="1.0"?><cdsSearch:searchResult xmlns:cdsSearch="x" xmlns:adtcore="y">
<cdsSearch:searchResultObject adtcore:uri="/sap/bc/adt/oo/classes/zcl_a" adtcore:name="ZCL_A" adtcore:type="CLAS/OC" adtcore:packageName="ZPKG">
  <cdsSearch:searchResultMatch line="12"><cdsSearch:snippet>SELECT * FROM t000 INTO @DATA(ls).</cdsSearch:snippet></cdsSearch:searchResultMatch>
  <cdsSearch:searchResultMatch line="40">  DATA lt TYPE TABLE OF t000.</cdsSearch:searchResultMatch>
</cdsSearch:searchResultObject>
<cdsSearch:searchResultObject adtcore:uri="/sap/bc/adt/programs/programs/zrep" adtcore:name="ZREP" adtcore:type="PROG/P"/>
<adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zi_x" adtcore:name="ZI_X" adtcore:type="DDLS/DF" adtcore:description="View &amp; co"/>
</cdsSearch:searchResult>`;

describe('textSearch parsing', () => {
  it('reads objects, matches, lines and snippets from both element shapes', () => {
    const r = parseTextSearchResponse(XML);
    expect(r).toHaveLength(4);
    expect(r[0]).toEqual({ objectUrl: '/sap/bc/adt/oo/classes/zcl_a', name: 'ZCL_A', type: 'CLAS/OC', packageName: 'ZPKG', description: undefined, line: 12, snippet: 'SELECT * FROM t000 INTO @DATA(ls).' });
    expect(r[1]).toMatchObject({ line: 40, snippet: 'DATA lt TYPE TABLE OF t000.' });
    expect(r[2]).toMatchObject({ name: 'ZREP', type: 'PROG/P' });
    expect(r[3]).toMatchObject({ name: 'ZI_X', description: 'View & co' });
    expect(parseTextSearchResponse('<x/>')).toEqual([]);
  });

  it('greps with context and builds literal or regex patterns', () => {
    const hits = grepSource('a\nselect * from T000.\nc\nd', buildPattern('from t000', false, false), 1, 10, { objectUrl: '/o', name: 'O', type: 'PROG/P' });
    expect(hits).toEqual([{ objectUrl: '/o', name: 'O', type: 'PROG/P', line: 2, text: 'select * from T000.', context: ['a', 'select * from T000.', 'c'] }]);
    expect(buildPattern('a.b', false, true).test('a.b')).toBe(true);
    expect(buildPattern('a.b', false, true).test('axb')).toBe(false);
    expect(buildPattern('^sel', true, false).test('SELECT')).toBe(true);
  });

  it('mapLimit preserves order under bounded concurrency', async () => {
    let active = 0, peak = 0;
    const r = await mapLimit([3, 1, 2], 2, async (n) => { active++; peak = Math.max(peak, active); await new Promise(res => setTimeout(res, n * 5)); active--; return n * 10; });
    expect(r).toEqual([30, 10, 20]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

function makeHandler(opts: { status?: number; body?: string; nodes?: any[]; sources?: Record<string, string> } = {}) {
  const client: any = {
    httpClient: { request: jest.fn(async (_url: string, cfg: any) => ({ status: opts.status ?? 200, body: opts.body ?? XML, headers: {}, statusText: '' })) },
    nodeContents: jest.fn(async (_t: string, name: string) => ({
      nodes: name === 'ZPKG' ? (opts.nodes ?? [
        { OBJECT_TYPE: 'CLAS/OC', OBJECT_NAME: 'ZCL_A', OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_a' },
        { OBJECT_TYPE: 'DEVC/K', OBJECT_NAME: 'ZSUB', OBJECT_URI: '/sap/bc/adt/packages/zsub' },
        { OBJECT_TYPE: 'TABL/DT', OBJECT_NAME: 'ZTAB', OBJECT_URI: '/sap/bc/adt/ddic/tables/ztab' },
      ]) : [{ OBJECT_TYPE: 'PROG/P', OBJECT_NAME: 'ZREP', OBJECT_URI: '/sap/bc/adt/programs/programs/zrep' }],
      categories: [], objectTypes: []
    })),
    getObjectSource: jest.fn(async (url: string) => (opts.sources ?? {
      '/sap/bc/adt/oo/classes/zcl_a/source/main': 'CLASS zcl_a.\n  SELECT * FROM t000.\nENDCLASS.',
      '/sap/bc/adt/programs/programs/zrep/source/main': 'REPORT zrep.\nWRITE t000.'
    })[url] ?? '')
  };
  return { client, handler: new SearchHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);

describe('sourceTextSearch', () => {
  it('posts the discovery-template parameters and returns parsed results', async () => {
    const { client, handler } = makeHandler();
    const res = parse(await handler.handle('sourceTextSearch', { searchString: 't000', packages: 'ZPKG, ZSD', objectTypes: 'CLAS/OC', maxResults: 50 }));
    const [url, cfg] = client.httpClient.request.mock.calls[0];
    expect(url).toBe('/sap/bc/adt/repository/informationsystem/textsearch');
    expect(cfg.method).toBe('POST');
    expect(cfg.qs).toMatchObject({ searchString: 't000', searchToIndex: 50, packageName: ['ZPKG', 'ZSD'], objectType: ['CLAS/OC'] });
    expect(res.totalItems).toBe(4);
    expect(res.results[0].line).toBe(12);
  });

  it('retries with GET when POST is rejected by a thrown ADT exception', async () => {
    const { client, handler } = makeHandler();
    client.httpClient.request.mockRejectedValueOnce(Object.assign(new Error('Resource controller does not support method POST'), { err: 405 }));
    const res = parse(await handler.handle('sourceTextSearch', { searchString: 'x' }));
    expect(client.httpClient.request.mock.calls[1][1].method).toBe('GET');
    expect(res.totalItems).toBe(4);
  });

  it('retries with GET on 405', async () => {
    const { client, handler } = makeHandler();
    client.httpClient.request.mockResolvedValueOnce({ status: 405, body: '', headers: {} });
    await handler.handle('sourceTextSearch', { searchString: 'x' });
    expect(client.httpClient.request.mock.calls[1][1].method).toBe('GET');
  });

  it('falls back to grepPackage when the endpoint is missing and a package is given', async () => {
    const { handler } = makeHandler({ status: 404 });
    const res = parse(await handler.handle('sourceTextSearch', { searchString: 't000', packages: 'ZPKG' }));
    expect(res.fallback).toMatch(/grepPackage/);
    expect(res.totalMatches).toBe(2);
  });

  it('treats "Source Search is not supported" as unavailable and falls back', async () => {
    const { client, handler } = makeHandler();
    client.httpClient.request.mockRejectedValue(Object.assign(new Error('Source Search is not supported. | type: ABAP Text Search Resource Error | details: [T100KEY-ID: SRIS_SEARCH, T100KEY-NO: 6]'), { err: 400 }));
    const res = parse(await handler.handle('sourceTextSearch', { searchString: 't000', packages: 'ZPKG' }));
    expect(res.fallback).toMatch(/grepPackage/);
    await expect(handler.handle('sourceTextSearch', { searchString: 't000' })).rejects.toThrow(/source search not supported/);
  });

  it('explains when the endpoint is missing and no package is given', async () => {
    const { handler } = makeHandler({ status: 404 });
    await expect(handler.handle('sourceTextSearch', { searchString: 'x' })).rejects.toThrow(/grepPackage/);
  });
});

describe('grepPackage', () => {
  it('scans greppable objects recursively with cached sources and context', async () => {
    const { client, handler } = makeHandler();
    const res = parse(await handler.handle('grepPackage', { packageName: 'zpkg', pattern: 'T000' }));
    expect(res.packagesScanned).toEqual(['ZPKG', 'ZSUB']);
    expect(res.objectsScanned).toBe(2);
    expect(res.totalMatches).toBe(2);
    expect(res.matches[0]).toMatchObject({ name: 'ZCL_A', line: 2, text: '  SELECT * FROM t000.' });
    expect(res.matches[0].context).toHaveLength(3);
    // second run hits the source cache
    await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: 't000' });
    expect(client.getObjectSource).toHaveBeenCalledTimes(2);
  });

  it('honours recursive=false, objectTypes, maxMatches and regex', async () => {
    const { handler } = makeHandler();
    const flat = parse(await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: 't000', recursive: false }));
    expect(flat.packagesScanned).toEqual(['ZPKG']);
    const typed = parse(await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: 't000', objectTypes: 'PROG/P' }));
    expect(typed.objectsScanned).toBe(1);
    const capped = parse(await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: 't000', maxMatches: 1 }));
    expect(capped.returnedMatches).toBe(1);
    expect(capped.matchesTruncated).toBe(true);
    const rx = parse(await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: '^write', regex: true }));
    expect(rx.totalMatches).toBe(1);
    await expect(handler.handle('grepPackage', { packageName: 'ZPKG', pattern: '(', regex: true })).rejects.toThrow(/Invalid pattern/);
  });

  it('reports per-object download failures without aborting', async () => {
    const { client, handler } = makeHandler();
    client.getObjectSource.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const res = parse(await handler.handle('grepPackage', { packageName: 'ZPKG', pattern: 't000' }));
    expect(res.failures).toHaveLength(1);
    expect(res.totalMatches).toBe(1);
  });
});

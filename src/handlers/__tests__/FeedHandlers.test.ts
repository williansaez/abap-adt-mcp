import { FeedHandlers } from '../FeedHandlers';
import { summarizeDump, normalizeDumpId, toCompactTimestamp } from '../../lib/dumpParsing';

const ID = '20260831221142vhabap01_SID_00%20%20%20DEVELOPER080%20%20%2014';
const HTML = `<p><a class="showInRuntimeViewerLink" href="adt://SID/sap/bc/adt/runtime/dump/${ID}">Show in Runtime Error Viewer</a></p><h4 id="OVERVIEW">Contents</h4><h4 id="HEADERX">Header Information</h4><table cellspacing="3"><tr><td><b>Short Text&nbsp;</b></td><td nowrap> An exception has occurred that was not caught. </td></tr><tr><td><b>Runtime Error&nbsp;</b></td><td nowrap> UNCAUGHT_EXCEPTION </td></tr><tr><td><b>Exception&nbsp;</b></td><td nowrap> CX_TPDAPI_INVALID_PARAM </td></tr><tr><td><b>Program&nbsp;</b></td><td nowrap> CL_TPDA_ADT_RES_BREAKPOINTS===CP </td></tr><tr><td><b>Application Component&nbsp;</b></td><td nowrap> BC-DWB-AIE-TST </td></tr><tr><td><b>Date/Time&nbsp;</b></td><td nowrap> 08/31/2026 22:11:42 (System) </td></tr><tr><td><b>User&nbsp;</b></td><td nowrap> DEVELOPER (Willian Saez) </td></tr><tr><td><b>Client&nbsp;</b></td><td nowrap> 080 </td></tr><tr><td><b>Host&nbsp;</b></td><td nowrap> vhabap01_SID_00 </td></tr></table><h4 id="WHATHAPPENED">What happened?</h4>The exception of class "CX_TPDAPI_INVALID_PARAM" was triggered but not caught anywhere in the<br>call hierarchy.<h4 id="ERROR">Error analysis</h4>Parameter I_STRING in method FILL_STRUCTURE_FROM_STRING is not valid<br><h4 id="TERMINATION">Information on where terminated</h4>The termination occurred in ABAP program or include "CL_TPDAPI_TRAFO===============CP", in "FILL_STRUCTURE_FROM_STRING".<h4 id="SOURCE">Source Code Extract</h4><style> .x { } </style><table id="sourcetable"><tr><td><span class="linenumber"><a title="Show where terminated" href="adt://SID/sap/bc/adt/oo/classes/cl_tpdapi_trafo/source/main#start=127,0"><span class="indicator">>></span></a></span></td></tr></table><h4 id="STACK">Active Calls/Events</h4><style>code { }</style><table cellspacing="5"><tr><th align="left">No.</th></tr><tr><td><code><a href="adt://SID/sap/bc/adt/oo/classes/cl_tpdapi_trafo/source/main#start=127">12</a></code></td><td><code>FILL_STRUCTURE_FROM_STRING</code></td><td><code>CL_TPDAPI_TRAFO===============CP</code></td><td><code>CL_TPDAPI_TRAFO===============CM002</code></td><td><code>18</code></td></tr><tr><td><code><a href="adt://SID/sap/bc/adt/programs/programs/sapmhttp/source/main#start=12">1</a></code></td><td><code>%_HTTP_START</code></td><td><code>SAPMHTTP</code></td><td><code>SAPMHTTP</code></td><td><code>12</code></td></tr></table>`;

function dump(overrides: Partial<{ id: string; author: string; text: string }> = {}) {
  const id = overrides.id ?? ID;
  return {
    categories: [{ term: 'UNCAUGHT_EXCEPTION', label: 'ABAP runtime error' }, { term: 'CL_TPDAPI_TRAFO===============CP', label: 'Terminated ABAP program' }],
    links: [
      { href: `adt://SID/sap/bc/adt/vit/runtime/dumps/${id}`, rel: 'alternate', type: 'application/vnd.sap.adt.sapgui' },
      { href: `adt://SID/sap/bc/adt/runtime/dump/${id}`, rel: 'self', type: 'text/plain' }
    ],
    id: `/sap/bc/adt/vit/runtime/dumps/${id}`,
    author: overrides.author ?? 'DEVELOPER',
    text: overrides.text ?? HTML,
    type: 'html'
  };
}

function makeHandler(dumps: any[], detailsText = 'line1\nline2\nline3') {
  const client: any = {
    dumps: jest.fn(async () => ({ href: '/sap/bc/adt/runtime/dumps?from=20260831221142', title: 'ABAP Short Dump Analysis', updated: new Date('2026-09-02T19:38:24Z'), dumps })),
    httpClient: { request: jest.fn(async () => ({ body: detailsText, status: 200, statusText: 'OK', headers: {} })) }
  };
  return { client, handler: new FeedHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);

describe('dump parsing', () => {
  it('extracts the header fields, termination point and stack from the HTML', () => {
    const s = summarizeDump(dump());
    expect(s.dumpId).toBe(ID);
    expect(s.timestamp).toBe('2026-08-31T22:11:42');
    expect(s.user).toBe('DEVELOPER');
    expect(s.runtimeError).toBe('UNCAUGHT_EXCEPTION');
    expect(s.exception).toBe('CX_TPDAPI_INVALID_PARAM');
    expect(s.shortText).toBe('An exception has occurred that was not caught.');
    expect(s.program).toBe('CL_TPDA_ADT_RES_BREAKPOINTS===CP');
    expect(s.applicationComponent).toBe('BC-DWB-AIE-TST');
    expect(s.client).toBe('080');
    expect(s.terminatedAt).toEqual({ objectSourceUrl: '/sap/bc/adt/oo/classes/cl_tpdapi_trafo/source/main', line: 127 });
    expect(s.errorAnalysis).toContain('Parameter I_STRING');
    expect(s.whereTerminated).toContain('FILL_STRUCTURE_FROM_STRING');
    expect(s.stack).toHaveLength(2);
    expect(s.stack[0]).toEqual({ no: 12, event: 'FILL_STRUCTURE_FROM_STRING', program: 'CL_TPDAPI_TRAFO===============CP', include: 'CL_TPDAPI_TRAFO===============CM002', line: 18, sourceUrl: '/sap/bc/adt/oo/classes/cl_tpdapi_trafo/source/main#start=127' });
  });

  it('falls back to categories when the HTML has no header table', () => {
    const s = summarizeDump(dump({ text: '<p>nothing</p>' }));
    expect(s.runtimeError).toBe('UNCAUGHT_EXCEPTION');
    expect(s.program).toBe('CL_TPDAPI_TRAFO===============CP');
    expect(s.stack).toEqual([]);
  });

  it('normalizes every dump id form to the encoded id segment', () => {
    expect(normalizeDumpId(`adt://SID/sap/bc/adt/runtime/dump/${ID}`)).toBe(ID);
    expect(normalizeDumpId(`/sap/bc/adt/vit/runtime/dumps/${ID}`)).toBe(ID);
    expect(normalizeDumpId(ID)).toBe(ID);
    expect(normalizeDumpId('20260831221142host_SID_00 X 14')).toBe(encodeURIComponent('20260831221142host_SID_00 X 14'));
  });

  it('accepts compact, date-only and ISO timestamps', () => {
    expect(toCompactTimestamp('20260831221142')).toBe('20260831221142');
    expect(toCompactTimestamp('20260831')).toBe('20260831000000');
    expect(toCompactTimestamp('2026-08-31T22:11:42Z')).toBe('20260831221142');
    expect(toCompactTimestamp(undefined)).toBeUndefined();
    expect(() => toCompactTimestamp('yesterday')).toThrow(/Invalid timestamp/);
  });
});

describe('dumps tool', () => {
  it('returns compact summaries without the HTML by default', async () => {
    const { handler } = makeHandler([dump()]);
    const res = parse(await handler.handle('dumps', {}));
    expect(res.totalItems).toBe(1);
    expect(res.dumps[0].runtimeError).toBe('UNCAUGHT_EXCEPTION');
    expect(res.dumps[0].html).toBeUndefined();
    expect(res.content).toBeUndefined();
  });

  it('includes the HTML only on request', async () => {
    const { handler } = makeHandler([dump()]);
    const res = parse(await handler.handle('dumps', { includeHtml: true }));
    expect(res.dumps[0].html).toContain('<h4 id="HEADERX">');
  });

  it('filters by from/to, user and contains', async () => {
    const older = dump({ id: '20260801000000host_SID_00%20X%2014', author: 'OTHER' });
    const { handler } = makeHandler([dump(), older]);
    expect(parse(await handler.handle('dumps', { from: '2026-08-15' })).dumps).toHaveLength(1);
    expect(parse(await handler.handle('dumps', { to: '20260815000000' })).dumps[0].user).toBe('OTHER');
    expect(parse(await handler.handle('dumps', { user: 'developer' })).totalItems).toBe(1);
    expect(parse(await handler.handle('dumps', { contains: 'tpdapi_invalid' })).totalItems).toBe(2);
    expect(parse(await handler.handle('dumps', { contains: 'nomatch' })).totalItems).toBe(0);
    const res = parse(await handler.handle('dumps', { user: 'OTHER' }));
    expect(res.filters).toEqual({ from: undefined, to: undefined, user: 'OTHER', contains: undefined });
    expect(res.totalInFeed).toBe(2);
  });

  it('rejects an unparsable from value', async () => {
    const { handler } = makeHandler([dump()]);
    await expect(handler.handle('dumps', { from: 'soon' })).rejects.toThrow(/Invalid timestamp/);
  });

  it('pages with startIndex/maxItems', async () => {
    const { handler } = makeHandler([dump(), dump({ id: '20260801000000a%2014' }), dump({ id: '20260701000000b%2014' })]);
    const res = parse(await handler.handle('dumps', { startIndex: 1, maxItems: 1 }));
    expect(res).toMatchObject({ totalItems: 3, startIndex: 1, returnedItems: 1, hasMore: true });
  });
});

describe('dumpDetails tool', () => {
  it('requests the text/plain dump by normalized id and pages the lines', async () => {
    const { client, handler } = makeHandler([], 'l1\nl2\nl3\nl4');
    const res = parse(await handler.handle('dumpDetails', { dumpId: `adt://SID/sap/bc/adt/runtime/dump/${ID}`, startLine: 2, maxLines: 2 }));
    expect(client.httpClient.request).toHaveBeenCalledWith(`/sap/bc/adt/runtime/dump/${ID}`, { method: 'GET', headers: { Accept: 'text/plain' } });
    expect(res).toMatchObject({ dumpId: ID, text: 'l2\nl3', totalLines: 4, startLine: 2, returnedLines: 2, hasMore: true });
  });
});

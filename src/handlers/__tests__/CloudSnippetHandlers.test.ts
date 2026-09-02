import { CloudHandlers } from '../CloudHandlers';
import { SnippetHandlers, buildSnippetClass, snippetClassName } from '../SnippetHandlers';
import { sourceCache } from '../../lib/sourceCache';

const REL = JSON.stringify({ objectReleaseInfo: [{ tadirObject: 'CLAS', tadirObjName: 'CL_ABAP_CHAR_UTILITIES', state: 'released' }, { tadirObject: 'TABL', tadirObjName: 'MARA', state: 'deprecated', successors: [{ tadirObject: 'DDLS', tadirObjName: 'I_PRODUCT' }] }] });
const CLS = JSON.stringify({ objectClassifications: [{ tadirObject: 'CLAS', tadirObjName: 'CL_GUI_ALV_GRID', state: 'classicAPI' }] });
const parse = (r: any) => JSON.parse(r.content[0].text);
beforeEach(() => sourceCache.clear());

describe('apiReleaseState', () => {
  const loader = jest.fn(async (url: string) => url.includes('Classifications') ? CLS : REL);
  function make(status = 404) {
    const client: any = {
      httpClient: { request: jest.fn(async () => ({ status, body: '<apirelease:release adtcore:name="CL_X" releaseState="RELEASED" successor="CL_Y"/>', headers: {} })) },
      getObjectSource: jest.fn(async () => 'DATA x TYPE REF TO cl_gui_alv_grid.\nSELECT * FROM mara INTO TABLE @DATA(t).')
    };
    return { client, handler: new CloudHandlers(client, loader) };
  }

  it('checks names against the repository and summarizes blockers', async () => {
    const { handler } = make();
    const res = parse(await handler.handle('apiReleaseState', { names: 'cl_abap_char_utilities, TABL:MARA, CL_GUI_ALV_GRID, ZCL_MINE', refresh: true }));
    expect(res.summary).toEqual({ checked: 4, cloudReady: 2, notCloudReady: 2, customerObjects: 1 });
    expect(res.blockers.map((b: any) => b.name)).toEqual(['MARA', 'CL_GUI_ALV_GRID']);
    expect(res.blockers[0].successors).toEqual([{ name: 'I_PRODUCT', type: 'DDLS' }]);
  });

  it('scans a source URL and reports the backend apireleases answer when available', async () => {
    const { client, handler } = make(200);
    const res = parse(await handler.handle('apiReleaseState', { sourceUrl: '/sap/bc/adt/oo/classes/zcl_a/source/main', objectUrl: '/sap/bc/adt/oo/classes/cl_abap_char_utilities' }));
    expect(client.getObjectSource).toHaveBeenCalled();
    expect(res.scannedIdentifiers).toBe(2);
    expect(res.results.map((r: any) => r.name)).toEqual(expect.arrayContaining(['CL_GUI_ALV_GRID', 'MARA', 'CL_ABAP_CHAR_UTILITIES']));
    expect(res.backendApiRelease).toMatchObject({ available: true, attributes: { releaseState: 'RELEASED', successor: 'CL_Y' } });
  });

  it('requires some input', async () => {
    const { handler } = make();
    await expect(handler.handle('apiReleaseState', {})).rejects.toThrow(/Pass names/);
  });
});

describe('runSnippet', () => {
  function make(opts: { activationFails?: boolean; runFails?: boolean } = {}) {
    const client: any = {
      stateful: 'stateless',
      createObject: jest.fn(async () => undefined),
      lock: jest.fn(async () => ({ LOCK_HANDLE: 'H' })),
      unLock: jest.fn(async () => undefined),
      setObjectSource: jest.fn(async () => undefined),
      activate: jest.fn(async () => opts.activationFails ? { success: false, messages: [{ type: 'E', line: 8, shortText: 'Field X unknown' }] } : { success: true, messages: [] }),
      runClass: jest.fn(async () => { if (opts.runFails) throw new Error('Request failed with status code 500'); return 'Hello from snippet'; }),
      deleteObject: jest.fn(async () => undefined),
    };
    return { client, handler: new SnippetHandlers(client) };
  }

  it('wraps statements in a classrun class and accepts full classes', () => {
    const w = buildSnippetClass('ZCL_MCP_SNIP_ABC', "out->write( 'hi' ).");
    expect(w.wrapped).toBe(true);
    expect(w.source).toContain('CLASS zcl_mcp_snip_abc DEFINITION PUBLIC FINAL CREATE PUBLIC.');
    expect(w.source).toContain('INTERFACES if_oo_adt_classrun.');
    expect(w.source.split('\n')[7]).toBe("    out->write( 'hi' ).");
    const f = buildSnippetClass('ZCL_T', 'CLASS zcl_other DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_other IMPLEMENTATION.\nENDCLASS.');
    expect(f.wrapped).toBe(false);
    expect(f.source).toContain('CLASS zcl_t DEFINITION');
    expect(f.source).toContain('CLASS zcl_t IMPLEMENTATION');
    expect(snippetClassName('abc-12')).toBe('ZCL_MCP_SNIP_ABC120');
  });

  it('creates, writes, activates, runs and deletes the temporary class', async () => {
    const { client, handler } = make();
    const res = parse(await handler.handle('runSnippet', { code: "out->write( 'hi' ).", className: 'zcl_t', responsible: 'dev' }));
    expect(client.createObject).toHaveBeenCalledWith('CLAS/OC', 'ZCL_T', '$TMP', expect.any(String), '/sap/bc/adt/packages/%24tmp', 'DEV', undefined);
    expect(client.setObjectSource).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_t/source/main', expect.stringContaining('if_oo_adt_classrun'), 'H', undefined);
    expect(client.activate).toHaveBeenCalledWith('ZCL_T', '/sap/bc/adt/oo/classes/zcl_t');
    expect(client.runClass).toHaveBeenCalledWith('ZCL_T');
    expect(client.deleteObject).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_t', 'H', undefined);
    expect(res).toMatchObject({ status: 'success', output: 'Hello from snippet', steps: ['created', 'source written', 'activated', 'ran', 'deleted'], kept: false });
  });

  it('returns activation messages and cleans up without running', async () => {
    const { client, handler } = make({ activationFails: true });
    const r = await handler.handle('runSnippet', { code: 'x = y.', className: 'ZCL_T' });
    const res = parse(r);
    expect(r.isError).toBe(true);
    expect(res).toMatchObject({ status: 'error', phase: 'activation' });
    expect(res.messages[0].shortText).toBe('Field X unknown');
    expect(client.runClass).not.toHaveBeenCalled();
    expect(client.deleteObject).toHaveBeenCalled();
  });

  it('keeps the class on request and cleans up when the run fails', async () => {
    const { client, handler } = make();
    const kept = parse(await handler.handle('runSnippet', { code: 'x.', className: 'ZCL_T', keep: true }));
    expect(kept.kept).toBe(true);
    expect(client.deleteObject).not.toHaveBeenCalled();
    const failing = make({ runFails: true });
    await expect(failing.handler.handle('runSnippet', { code: 'x.', className: 'ZCL_T' })).rejects.toThrow(/runSnippet failed after created, source written, activated/);
    expect(failing.client.deleteObject).toHaveBeenCalled();
  });
});

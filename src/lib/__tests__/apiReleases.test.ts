process.env.MCP_CACHE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'abap-adt-mcp-cache-'));
import { buildIndex, lookup, parseObjectRef, objectRefFromUrl, candidatesFromSource, entriesOf, isProhibited, extraClassificationFiles, getReleaseIndex } from '../apiReleases';

const REL = JSON.stringify({ formatVersion: '1', objectReleaseInfo: [
  { tadirObject: 'CLAS', tadirObjName: 'CL_ABAP_CHAR_UTILITIES', objectType: 'CLAS', objectKey: 'CL_ABAP_CHAR_UTILITIES', softwareComponent: 'SAP_BASIS', applicationComponent: 'BC-ABA-LA', state: 'released' },
  { tadirObject: 'DDLS', tadirObjName: 'I_PRODUCT', objectType: 'DDLS', objectKey: 'I_PRODUCT', state: 'released' },
  { tadirObject: 'CHKV', tadirObjName: 'SAP_CP_READINESS', state: 'deprecated', successorClassification: 'oneObject', successors: [{ tadirObject: 'CHKV', tadirObjName: 'ABAP_CLOUD_DEVELOPMENT_DEFAULT' }] },
  { tadirObject: 'TABL', tadirObjName: 'I_PRODUCT', state: 'deprecated' },
] });
const CLS = JSON.stringify({ formatVersion: '2', objectClassifications: [
  { tadirObject: 'CLAS', tadirObjName: 'CL_GUI_ALV_GRID', state: 'classicAPI', applicationComponent: 'BC-SRV-ALV' },
  { tadirObject: 'TABL', tadirObjName: 'MARA', state: 'noAPI' },
] });

describe('apiReleases', () => {
  const index = buildIndex('cloud', REL, CLS);

  it('indexes released and classified objects', () => {
    expect(index.counts).toEqual({ released: 4, classifications: 2 });
    expect(lookup(index, { name: 'cl_abap_char_utilities' })).toMatchObject({ state: 'released', cloudReady: true, type: 'CLAS' });
    expect(lookup(index, { name: 'MARA' })).toMatchObject({ state: 'noAPI', cloudReady: false });
    expect(lookup(index, { name: 'CL_GUI_ALV_GRID' }).note).toMatch(/Classic API/);
  });

  it('returns successors for deprecated objects and honours the type filter', () => {
    const d = lookup(index, { name: 'SAP_CP_READINESS' });
    expect(d).toMatchObject({ state: 'deprecated', cloudReady: false });
    expect(d.successors).toEqual([{ name: 'ABAP_CLOUD_DEVELOPMENT_DEFAULT', type: 'CHKV' }]);
    expect(lookup(index, { name: 'I_PRODUCT', type: 'TABL' }).state).toBe('deprecated');
    expect(lookup(index, { name: 'I_PRODUCT', type: 'DDLS' }).state).toBe('released');
  });

  it('classifies customer objects and unknown SAP objects', () => {
    expect(lookup(index, { name: 'ZCL_MINE' })).toMatchObject({ state: 'customer', cloudReady: true });
    expect(lookup(index, { name: '/ACME/CL_X' })).toMatchObject({ state: 'customer' });
    expect(lookup(index, { name: 'BAPI_UNKNOWN' })).toMatchObject({ state: 'unknown', cloudReady: false });
  });

  it('parses refs and ADT urls', () => {
    expect(parseObjectRef('TABL:mara')).toEqual({ type: 'TABL', name: 'MARA' });
    expect(parseObjectRef('cl_x')).toEqual({ name: 'CL_X' });
    expect(objectRefFromUrl('/sap/bc/adt/oo/classes/cl_abap_char_utilities/source/main')).toEqual({ name: 'CL_ABAP_CHAR_UTILITIES', type: 'CLAS' });
    expect(objectRefFromUrl('/sap/bc/adt/ddic/tables/mara')).toEqual({ name: 'MARA', type: 'TABL' });
    expect(objectRefFromUrl('nonsense')).toBeUndefined();
  });

  it('extracts referenced SAP objects from source, skipping comments and customer names', () => {
    const src = `* select from zold\nDATA lt TYPE TABLE OF mara. " from vbak\nSELECT * FROM t000 INTO TABLE @DATA(x).\nDATA lo TYPE REF TO cl_abap_char_utilities.\nCALL FUNCTION 'BAPI_USER_GET_DETAIL'.\nCLASS zcl_a DEFINITION INHERITING FROM cl_base.\nDATA n TYPE i.`;
    const c = candidatesFromSource(src);
    expect(c).toEqual(expect.arrayContaining(['MARA', 'T000', 'CL_ABAP_CHAR_UTILITIES', 'BAPI_USER_GET_DETAIL', 'CL_BASE']));
    expect(c).not.toContain('ZOLD');
    expect(c).not.toContain('VBAK');
    expect(c).not.toContain('I');
  });

  it('ignores names declared in the source and reports unknown SAP names as uncertain, not blockers', () => {
    const src = [
      'CLASS lcl_helper DEFINITION. ENDCLASS.',
      'TYPES: BEGIN OF ty_row, id TYPE i, END OF ty_row.',
      'TYPES ty_rows TYPE STANDARD TABLE OF ty_row.',
      'DATA lo TYPE REF TO lcl_helper.',
      'DATA lt TYPE ty_rows.',
      'DATA lx TYPE REF TO cx_sy_zerodivide.',
      'SELECT * FROM mara INTO TABLE @DATA(lt_mara).',
    ].join('\n');
    const names = candidatesFromSource(src);
    expect(names).toEqual(expect.arrayContaining(['CX_SY_ZERODIVIDE', 'MARA']));
    expect(names).not.toEqual(expect.arrayContaining(['LCL_HELPER', 'TY_ROW', 'TY_ROWS']));
    const index = buildIndex('cloud', REL, CLS);
    expect(lookup(index, { name: 'CL_SOMETHING_ODD' })).toMatchObject({ state: 'unknown', cloudReady: false });
  });
});

describe('apiReleases: API policy standing', () => {
  const rel = JSON.stringify({ formatVersion: '1', objectReleaseInfo: [
    { tadirObject: 'CLAS', tadirObjName: 'CL_RELEASED', state: 'released' },
    { tadirObject: 'CLAS', tadirObjName: 'CL_OLD', state: 'deprecated', successorClassification: 'concept', successorConceptName: 'Use the RAP facade' },
    { tadirObject: 'TABL', tadirObjName: 'VBAK', state: 'notToBeReleased', successors: [{ tadirObject: 'DDLS', tadirObjName: 'I_SALESORDER' }] },
    { tadirObject: 'CLAS', tadirObjName: 'CL_STABLE', state: 'notToBeReleasedStable' },
    { tadirObject: 'FUNC', tadirObjName: 'Z_NOT_OURS', state: 'released' },
    // A name that is released as one type and banned as another.
    { tadirObject: 'CLAS', tadirObjName: 'DUAL', state: 'released' },
  ] });
  const cls = JSON.stringify({ formatVersion: '2', objectClassifications: [
    { tadirObject: 'FUGR', tadirObjName: 'SOME_GROUP', state: 'classicAPI', labels: ['remote-enabled', 'transactional-consistent'] },
    { tadirObject: 'TABL', tadirObjName: 'MARA', state: 'noAPI' },
  ] });
  // What SAP announced but has not published: the key, the state and the label are guesses on purpose.
  const announced = JSON.stringify({ formatVersion: '3', objectProhibitions: [
    { tadirObject: 'FUNC', tadirObjName: 'RFC_BANNED', state: 'prohibited', successors: [{ tadirObject: 'DDLS', tadirObjName: 'I_REPLACEMENT' }] },
    { tadirObject: 'CLAS', tadirObjName: 'CL_RELEASED', state: 'notPermitted' },
    { tadirObject: 'TABL', tadirObjName: 'LABELLED', state: 'noAPI', labels: ['Not-Allowed'] },
    { tadirObject: 'FUNC', tadirObjName: 'DUAL', state: 'unpermitted' },
    { tadirObject: 'CLAS', tadirObjName: 'CL_FUTURE', state: 'releasedForPartners' },
    { tadirObject: 'CLAS', state: 'prohibited' },
    'not an entry',
  ], note: 'ignored' });
  const index = buildIndex('cloud', rel, cls, [{ file: 'prohibited.json', json: announced }, { file: 'gone.json', error: 'GET failed with HTTP 404' }, { file: 'broken.json', json: '{' }]);

  it('maps the states the repository uses today', () => {
    expect(lookup(index, { name: 'CL_OLD' })).toMatchObject({ state: 'deprecated', apiPolicy: 'released', cloudReady: false, successorConcept: 'Use the RAP facade' });
    expect(lookup(index, { name: 'VBAK' })).toMatchObject({ state: 'notToBeReleased', apiPolicy: 'notReleased', cloudReady: false, successors: [{ name: 'I_SALESORDER', type: 'DDLS' }] });
    expect(lookup(index, { name: 'VBAK' }).note).toMatch(/own risk/);
    expect(lookup(index, { name: 'CL_STABLE' }).note).toMatch(/marks it as stable/);
    expect(lookup(index, { name: 'SOME_GROUP' })).toMatchObject({ state: 'classicAPI', apiPolicy: 'classic', labels: ['remote-enabled', 'transactional-consistent'] });
    expect(lookup(index, { name: 'MARA' })).toMatchObject({ state: 'noAPI', apiPolicy: 'notReleased' });
    expect(lookup(index, { name: 'ZCL_MINE' })).toMatchObject({ apiPolicy: 'customer' });
    expect(lookup(index, { name: 'BAPI_UNKNOWN' })).toMatchObject({ apiPolicy: 'unknown' });
    expect(lookup(index, { name: 'VBAK' }).unrecognizedState).toBeUndefined();
  });

  it('reads a prohibition from any file, key, state or label, and lets it outrank a release', () => {
    expect(entriesOf(announced)).toHaveLength(5);
    expect(lookup(index, { name: 'RFC_BANNED' })).toMatchObject({ state: 'prohibited', apiPolicy: 'prohibited', cloudReady: false, source: 'prohibited.json', successors: [{ name: 'I_REPLACEMENT', type: 'DDLS' }] });
    expect(lookup(index, { name: 'CL_RELEASED' })).toMatchObject({ state: 'notPermitted', apiPolicy: 'prohibited', cloudReady: false });
    expect(lookup(index, { name: 'LABELLED' })).toMatchObject({ state: 'noAPI', apiPolicy: 'prohibited', labels: ['Not-Allowed'] });
    expect(lookup(index, { name: 'DUAL', type: 'CLAS' })).toMatchObject({ state: 'released', apiPolicy: 'released', cloudReady: true });
    expect(lookup(index, { name: 'DUAL', type: 'FUNC' })).toMatchObject({ apiPolicy: 'prohibited' });
    expect(lookup(index, { name: 'DUAL' })).toMatchObject({ apiPolicy: 'prohibited' });
    expect(isProhibited({ state: 'notToBeReleased' })).toBe(false);
    expect(isProhibited({ state: 'released', labels: ['remote-enabled'] })).toBe(false);
  });

  it('passes through a state it does not know, flagged, and never as cloud ready', () => {
    const v = lookup(index, { name: 'CL_FUTURE' });
    expect(v).toMatchObject({ state: 'releasedForPartners', apiPolicy: 'notReleased', cloudReady: false, unrecognizedState: true });
    expect(v.note).toMatch(/"releasedForPartners"/);
  });

  it('knows the interfaces an SAP Note declares unpermitted, even under the customer-looking rule', () => {
    expect(lookup(index, { name: 'rodps_repl_odp_fetch', type: 'FUNC' })).toMatchObject({ state: 'unpermitted', apiPolicy: 'prohibited', cloudReady: false, sapNote: '3255746' });
    expect(lookup(index, { name: 'RODPS_REPL' }).note).toMatch(/SAP Note 3255746/);
    expect(lookup(index, { name: 'Z_NOT_OURS' })).toMatchObject({ state: 'released' });
  });

  it('reports every extra file: entries read, or why not', () => {
    expect(index.extraFiles).toEqual([
      { file: 'prohibited.json', entries: 5 },
      { file: 'gone.json', error: 'GET failed with HTTP 404' },
      { file: 'broken.json', error: expect.stringMatching(/not valid JSON/) },
    ]);
    expect(index.counts).toEqual({ released: 6, classifications: 7 });
  });

  it('accepts repository paths and https URLs in MCP_API_CLASSIFICATION_FILES and nothing else', () => {
    expect(extraClassificationFiles({} as any)).toEqual([]);
    expect(extraClassificationFiles({ MCP_API_CLASSIFICATION_FILES: 'partner/objectClassifications_ACME.json, https://example.com/lists/prohibited.json?v=2' } as any)).toEqual([
      { file: 'partner/objectClassifications_ACME.json', url: 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/partner/objectClassifications_ACME.json', cacheName: 'partner_objectClassifications_ACME.json' },
      { file: 'https://example.com/lists/prohibited.json?v=2', url: 'https://example.com/lists/prohibited.json?v=2', cacheName: 'extra-example.com_lists_prohibited.json_v_2' },
    ]);
    for (const bad of ['http://example.com/x.json', '../secrets.json', 'partner/../../x.json', '/etc/passwd', 'file:///x.json', 'list.txt']) {
      expect(() => extraClassificationFiles({ MCP_API_CLASSIFICATION_FILES: bad } as any)).toThrow(/MCP_API_CLASSIFICATION_FILES/);
    }
  });

  it('loads the extra files next to the standard ones and survives one that fails', async () => {
    const saved = process.env.MCP_API_CLASSIFICATION_FILES;
    process.env.MCP_API_CLASSIFICATION_FILES = 'https://example.com/prohibited.json,partner/missing.json';
    try {
      const loader = jest.fn(async (url: string) => {
        if (url === 'https://example.com/prohibited.json') return announced;
        if (url.endsWith('partner/missing.json')) throw new Error('GET failed with HTTP 404');
        return url.includes('Classifications') ? cls : rel;
      });
      const loaded = await getReleaseIndex('pce', loader, true);
      expect(loader).toHaveBeenCalledWith(expect.stringMatching(/objectReleaseInfo_PCELatest\.json$/));
      expect(loaded.extraFiles).toEqual([
        { file: 'https://example.com/prohibited.json', entries: 5 },
        { file: 'partner/missing.json', error: expect.stringMatching(/HTTP 404/) },
      ]);
      expect(lookup(loaded, { name: 'RFC_BANNED' })).toMatchObject({ apiPolicy: 'prohibited', source: 'https://example.com/prohibited.json' });
    } finally {
      if (saved === undefined) delete process.env.MCP_API_CLASSIFICATION_FILES; else process.env.MCP_API_CLASSIFICATION_FILES = saved;
    }
  });
});

import { buildIndex, lookup, parseObjectRef, objectRefFromUrl, candidatesFromSource } from '../apiReleases';

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
    expect(lookup(index, { name: 'BAPI_UNKNOWN' })).toMatchObject({ state: 'notInRepository', cloudReady: false });
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
});

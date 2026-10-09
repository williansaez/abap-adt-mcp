import { ObjectManagementHandlers } from '../ObjectManagementHandlers';
import { parseFlatInactiveObjects } from '../../lib/inactiveObjects740';

// Trimmed answer of P03 (SAP_BASIS 740 SP07) for /sap/bc/adt/activation/inactiveobjects.
const FLAT = '<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/includes/zmcp_rfc_x_inc" adtcore:type="PROG/I" adtcore:name="ZMCP_RFC_X_INC"/>' +
  '<adtcore:objectReference adtcore:uri="/sap/bc/adt/functions/groups/zmcp_rfc_fg/fmodules/zmcp_rfc_fm" adtcore:type="FUGR/FF" adtcore:name="ZMCP_RFC_FM" adtcore:parentUri="/sap/bc/adt/functions/groups/zmcp_rfc_fg"/>' +
  '</adtcore:objectReferences>';

describe('inactive objects on SAP_BASIS 7.40', () => {
  it('reads the flat objectReferences list', () => {
    const list = parseFlatInactiveObjects(FLAT);
    expect(list.map(e => e.object['adtcore:name'])).toEqual(['ZMCP_RFC_X_INC', 'ZMCP_RFC_FM']);
    expect(list[0].object['adtcore:parentUri']).toBe('');
    expect(list[1].object['adtcore:parentUri']).toBe('/sap/bc/adt/functions/groups/zmcp_rfc_fg');
  });

  it('falls back when the library finds nothing, and keeps its answer otherwise', async () => {
    const client: any = { inactiveObjects: jest.fn(async () => []), httpClient: { request: jest.fn(async () => ({ body: FLAT })) } };
    const r = JSON.parse((await new ObjectManagementHandlers(client).handle('inactiveObjects', {})).content[0].text);
    expect(r).toHaveLength(2);
    const newer: any = { inactiveObjects: jest.fn(async () => [{ object: { 'adtcore:name': 'ZX' } }]), httpClient: { request: jest.fn() } };
    await new ObjectManagementHandlers(newer).handle('inactiveObjects', {});
    expect(newer.httpClient.request).not.toHaveBeenCalled();
  });
});

describe('activateObjects', () => {
  it('omits adtcore:parentUri for main objects and keeps it for children', async () => {
    // An empty parentUri made P03 (7.40) answer "Verificação da condição fracassou".
    const sent: any[] = [];
    const client: any = { httpClient: { request: jest.fn(async (_url: string, opts: any) => { sent.push(opts); return { body: '' }; }) } };
    const objects = [
      { 'adtcore:uri': '/sap/bc/adt/programs/programs/zmcp_rfc_x', 'adtcore:type': 'PROG/P', 'adtcore:name': 'ZMCP_RFC_X' },
      { 'adtcore:uri': '/sap/bc/adt/functions/groups/zfg/fmodules/zfm', 'adtcore:type': 'FUGR/FF', 'adtcore:name': 'ZFM', 'adtcore:parentUri': '/sap/bc/adt/functions/groups/zfg' }
    ];
    const r = JSON.parse((await new ObjectManagementHandlers(client).handle('activateObjects', { objects: JSON.stringify(objects) })).content[0].text);
    expect(r).toMatchObject({ success: true, messages: [], inactive: [] });
    expect(sent[0].qs).toEqual({ method: 'activate', preauditRequested: true });
    expect(sent[0].body).toContain('<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zmcp_rfc_x" adtcore:type="PROG/P" adtcore:name="ZMCP_RFC_X"/>');
    expect(sent[0].body).toContain('adtcore:parentUri="/sap/bc/adt/functions/groups/zfg"');
    expect(sent[0].body).not.toMatch(/parentUri="(undefined)?"/);
    await expect(new ObjectManagementHandlers(client).handle('activateObjects', { objects: '[{"adtcore:uri":"/x"}]' })).rejects.toThrow(/needs adtcore:uri, adtcore:type and adtcore:name/);
  });

  it('reports syntax errors as a failed activation', async () => {
    const body = '<?xml version="1.0"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="Programa ZX" type="E" line="1"><shortText><txt>FORM X não existe.</txt></shortText></msg></chkl:messages>';
    const client: any = { httpClient: { request: jest.fn(async () => ({ body })) } };
    const r = JSON.parse((await new ObjectManagementHandlers(client).handle('activateObjects', { objects: '[{"adtcore:uri":"/sap/bc/adt/programs/programs/zx","adtcore:type":"PROG/P","adtcore:name":"ZX"}]' })).content[0].text);
    expect(r.success).toBe(false);
    expect(r.messages[0]).toMatchObject({ type: 'E', shortText: 'FORM X não existe.' });
  });
});

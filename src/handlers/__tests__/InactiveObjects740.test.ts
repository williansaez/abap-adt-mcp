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
  it('accepts main objects without parentUri and sends an empty one', async () => {
    const client: any = { activate: jest.fn(async () => ({ success: true, messages: [], inactive: [] })) };
    const objects = [{ 'adtcore:uri': '/sap/bc/adt/programs/programs/zmcp_rfc_x', 'adtcore:type': 'PROG/P', 'adtcore:name': 'ZMCP_RFC_X' }];
    await new ObjectManagementHandlers(client).handle('activateObjects', { objects: JSON.stringify(objects) });
    expect(client.activate.mock.calls[0][0][0]['adtcore:parentUri']).toBe('');
    await expect(new ObjectManagementHandlers(client).handle('activateObjects', { objects: '[{"adtcore:uri":"/x"}]' })).rejects.toThrow(/needs adtcore:uri, adtcore:type and adtcore:name/);
  });
});

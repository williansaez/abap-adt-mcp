import { findInUserTree, isEmptyTransportsOfUser, parseUserTreeWithoutTargets } from '../transportTree740';

// Trimmed shape of the answer P03 (SAP_BASIS 740 SP07) sent for /sap/bc/adt/cts/transportrequests/P03K901865:
// the user's whole tree, no tm:target level, the number in the URL ignored.
const TREE = `<?xml version="1.0" encoding="utf-8"?><tm:root adtcore:name="MLS_BC" xmlns:tm="http://www.sap.com/cts/adt/tm" xmlns:adtcore="http://www.sap.com/adt/core">
<tm:workbench tm:category="Workbench"><tm:modifiable tm:status="Modificável">
<tm:request tm:number="P03K900002" tm:owner="MLS_BC" tm:desc="RC Base converter" tm:status="D" tm:uri="/sap/bc/adt/vit/wb/object_type/%20%20%20%20rq/object_name/P03K900002">
<atom:link href="/sap/bc/cts/transportrequests/P03K900002/releasejobs" rel="http://www.sap.com/cts/relations/releasejobs" xmlns:atom="http://www.w3.org/2005/Atom"/>
<tm:task tm:number="P03K900003" tm:owner="MLS_BC" tm:desc="Repair" tm:status="D">
<tm:abap_object tm:pgmid="LIMU" tm:type="METH" tm:name="ZCL_PDF                       BASE_CONVERTER" tm:wbtype="CLAS/OM"/>
<tm:abap_object tm:pgmid="LIMU" tm:type="CLSD" tm:name="ZCL_PDF" tm:wbtype="CLAS/OC"/>
</tm:task></tm:request>
<tm:request tm:number="P03K901865" tm:owner="MLS_BC" tm:desc="TESTE abap-adt-mcp RFC - NAO IMPORTAR" tm:status="D">
<tm:task tm:number="P03K901866" tm:owner="MLS_BC" tm:desc="TESTE abap-adt-mcp RFC - NAO IMPORTAR" tm:status="D"/>
</tm:request>
</tm:modifiable></tm:workbench></tm:root>`;

describe('transport tree of SAP_BASIS 7.40', () => {
  it('reads requests, tasks and objects without a tm:target level', () => {
    const t = parseUserTreeWithoutTargets(TREE);
    expect(isEmptyTransportsOfUser(t)).toBe(false);
    expect(t.customizing).toEqual([]);
    expect(t.workbench).toHaveLength(1);
    const [first, ours] = t.workbench[0].modifiable;
    expect(first['tm:number']).toBe('P03K900002');
    expect(first.tasks[0].objects.map((o: any) => o['tm:type'])).toEqual(['METH', 'CLSD']);
    expect(ours['tm:desc']).toBe('TESTE abap-adt-mcp RFC - NAO IMPORTAR');
  });

  it('finds one request or task by number in the tree', () => {
    expect(findInUserTree(TREE, 'p03k901865')).toMatchObject({ 'tm:number': 'P03K901865', tasks: [{ 'tm:number': 'P03K901866' }] });
    expect(findInUserTree(TREE, 'P03K900003')).toMatchObject({ 'tm:number': 'P03K900003', parent: 'P03K900002' });
    expect(findInUserTree(TREE, 'P03K999999')).toBeUndefined();
  });

  it('treats the newer shape and an empty answer as nothing found', () => {
    expect(isEmptyTransportsOfUser(parseUserTreeWithoutTargets('<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"/>'))).toBe(true);
    expect(isEmptyTransportsOfUser(parseUserTreeWithoutTargets(''))).toBe(true);
  });
});

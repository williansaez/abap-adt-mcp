import { fullParse, xmlArray, xmlNodeAttr } from 'abap-adt-api/build/utilities';

/**
 * SAP_BASIS 7.40 answers /sap/bc/adt/activation/inactiveobjects with a flat
 * adtcore:objectReferences > adtcore:objectReference list instead of the
 * ioc:inactiveObjects > ioc:entry > ioc:object > ioc:ref shape abap-adt-api
 * parses, so the library returns no entries. This reads the flat list into the
 * library's InactiveObjectRecord shape ({ object: { adtcore:uri, ... } }).
 */
export function parseFlatInactiveObjects(body: string): Array<{ object: any; transport?: any }> {
    const raw = fullParse(String(body ?? ''));
    return xmlArray<any>(raw, 'adtcore:objectReferences', 'adtcore:objectReference')
        .map(xmlNodeAttr)
        .filter((ref: any) => ref?.['adtcore:uri'])
        .map((ref: any) => ({ object: { 'adtcore:parentUri': '', ...ref } }));
}

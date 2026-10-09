import { fullParse, xmlArray, xmlNode, xmlNodeAttr } from 'abap-adt-api/build/utilities';

const attr = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Activation of several objects, as abap-adt-api's activate(objects) but
 * without adtcore:parentUri when an object has no parent. The library always
 * writes the attribute: an empty one makes SAP_BASIS 7.40 answer
 * "Verificação da condição fracassou" (seen on P03 for a program), and a
 * missing one becomes the text "undefined".
 */
export async function activateReferences(http: { request: (url: string, opts: any) => Promise<{ body?: string }> }, objects: any[], preauditRequested = true) {
    const refs = objects.map(o => {
        const parent = o['adtcore:parentUri'] ? ` adtcore:parentUri="${attr(o['adtcore:parentUri'])}"` : '';
        const type = o['adtcore:type'] ? ` adtcore:type="${attr(o['adtcore:type'])}"` : '';
        return `<adtcore:objectReference adtcore:uri="${attr(o['adtcore:uri'])}"${type}${parent} adtcore:name="${attr(o['adtcore:name'])}"/>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${refs.join('\n')}</adtcore:objectReferences>`;
    const response = await http.request('/sap/bc/adt/activation', { method: 'POST', qs: { method: 'activate', preauditRequested }, body });
    let messages: any[] = [];
    let inactive: any[] = [];
    let success = true;
    if (response.body) {
        const raw = fullParse(response.body);
        inactive = xmlArray<any>(raw, 'ioc:inactiveObjects', 'ioc:entry').map(entry => {
            const ref = xmlNode(entry, 'ioc:object', 'ioc:ref');
            return ref ? { object: xmlNodeAttr(ref) } : {};
        }).filter(e => e.object);
        messages = xmlArray<any>(raw, 'chkl:messages', 'msg').map(m => ({ ...xmlNodeAttr(m), shortText: (m.shortText && m.shortText.txt) || 'Syntax error' }));
        if (inactive.length > 0 || messages.some(m => /[EAX]/.test(String(m.type ?? '')))) success = false;
    }
    return { messages, success, inactive };
}

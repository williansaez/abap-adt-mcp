import { fullParse, xmlArray, xmlNodeAttr } from 'abap-adt-api/build/utilities';

/**
 * SAP_BASIS 7.40 answers /sap/bc/adt/cts/transportrequests with the logged-on
 * user's whole request tree, tm:root > tm:workbench|tm:customizing >
 * tm:modifiable|tm:released > tm:request > tm:task > tm:abap_object, without
 * the tm:target level newer releases put under the category. abap-adt-api
 * looks for tm:target only and reads that tree as empty. 7.40 also ignores the
 * request number in /transportrequests/<number> and sends the same tree.
 * These helpers read that shape into the structures abap-adt-api returns.
 */

const parseTask = (t: any) => ({
    ...xmlNodeAttr(t),
    links: xmlArray(t, 'atom:link').map(xmlNodeAttr),
    objects: xmlArray(t, 'tm:abap_object').map(xmlNodeAttr)
});

const parseRequest = (r: any) => ({ ...parseTask(r), tasks: xmlArray(r, 'tm:task').map(parseTask) });

function categories(body: string) {
    const raw = fullParse(String(body ?? ''));
    const read = (category: string) => xmlArray<any>(raw, 'tm:root', category).map(node => ({
        'tm:name': '',
        'tm:desc': '',
        'tm:category': xmlNodeAttr(node)['tm:category'] ?? '',
        modifiable: xmlArray(node, 'tm:modifiable', 'tm:request').map(parseRequest),
        released: xmlArray(node, 'tm:released', 'tm:request').map(parseRequest)
    })).filter(t => t.modifiable.length || t.released.length);
    return { workbench: read('tm:workbench'), customizing: read('tm:customizing') };
}

/** The tree as abap-adt-api's TransportsOfUser: each category holds one target without a name. */
export function parseUserTreeWithoutTargets(body: string): { workbench: any[]; customizing: any[] } {
    return categories(body);
}

/** One request (or task) of the tree by number, in the shape of abap-adt-api's transportDetails. */
export function findInUserTree(body: string, transportNumber: string): any | undefined {
    const wanted = String(transportNumber || '').toUpperCase();
    const { workbench, customizing } = categories(body);
    for (const target of [...workbench, ...customizing]) {
        for (const request of [...target.modifiable, ...target.released]) {
            if (String(request['tm:number']).toUpperCase() === wanted) return request;
            const task = request.tasks.find((t: any) => String(t['tm:number']).toUpperCase() === wanted);
            if (task) return { ...task, tasks: [], parent: request['tm:number'] };
        }
    }
    return undefined;
}

/** True when abap-adt-api found no request at all (empty categories, or details without a number). */
export function isEmptyTransportsOfUser(t: any): boolean {
    return !(t?.workbench?.length) && !(t?.customizing?.length);
}

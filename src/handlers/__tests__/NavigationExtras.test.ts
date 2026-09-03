import { NavigationHandlers } from '../NavigationHandlers';
import { ObjectManagementHandlers } from '../ObjectManagementHandlers';
import { RevisionHandlers } from '../RevisionHandlers';
import { walkPackage } from '../../lib/packageWalk';
import { sourceCache } from '../../lib/sourceCache';

beforeEach(() => sourceCache.clear());
const parse = (r: any) => JSON.parse(r.content[0].text);

const NODES: Record<string, any[]> = {
  ZROOT: [
    { OBJECT_TYPE: 'DEVC/K', OBJECT_NAME: 'ZSUB', OBJECT_URI: '/sap/bc/adt/packages/zsub', DESCRIPTION: 'Sub' },
    { OBJECT_TYPE: 'CLAS/OC', OBJECT_NAME: 'ZCL_A', OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_a', DESCRIPTION: 'A' },
    { OBJECT_TYPE: 'DDLS/DF', OBJECT_NAME: 'ZI_X', OBJECT_URI: '/sap/bc/adt/ddic/ddl/sources/zi_x' },
  ],
  ZSUB: [{ OBJECT_TYPE: 'PROG/P', OBJECT_NAME: 'ZREP', OBJECT_URI: '/sap/bc/adt/programs/programs/zrep' }],
};
const nodeContents = jest.fn(async (_t: string, name: string) => ({ nodes: NODES[name] || [], categories: [], objectTypes: [] }));

describe('walkPackage', () => {
  it('walks sub-packages to maxDepth and collects objects', async () => {
    const w = await walkPackage({ nodeContents } as any, 'zroot');
    expect(w.packages).toEqual(['ZROOT', 'ZSUB']);
    expect(w.objects.map(o => o.name)).toEqual(['ZCL_A', 'ZI_X', 'ZREP']);
    expect(w.tree.subPackages[0].objects[0].package).toBe('ZSUB');
    const shallow = await walkPackage({ nodeContents } as any, 'ZROOT', { maxDepth: 0, objectTypes: new Set(['CLAS/OC']) });
    expect(shallow.packages).toEqual(['ZROOT']);
    expect(shallow.objects.map(o => o.name)).toEqual(['ZCL_A']);
    const capped = await walkPackage({ nodeContents } as any, 'ZROOT', { maxObjects: 1 });
    expect(capped.truncated).toBe(true);
  });
});

describe('packageTree / whereUsed / cdsViewInfo', () => {
  function make() {
    const client: any = {
      nodeContents,
      searchObject: jest.fn(async (q: string) => q === 'ZCL_A' ? [{ 'adtcore:name': 'ZCL_A', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_a', 'adtcore:packageName': 'ZROOT' }] : (q === 'DUP' ? [{ 'adtcore:name': 'DUP', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/c' }, { 'adtcore:name': 'DUP', 'adtcore:type': 'PROG/P', 'adtcore:uri': '/p' }] : [])),
      usageReferences: jest.fn(async () => [
        { uri: '/sap/bc/adt/programs/programs/zrep/source/main#start=10', objectIdentifier: 'ZREP', parentUri: '/sap/bc/adt/programs/programs/zrep', isResult: true, canHaveChildren: false, usageInformation: 'reference' },
        { uri: '/x', objectIdentifier: 'GROUP', parentUri: '/x', isResult: false, canHaveChildren: true, usageInformation: '' },
      ]),
      ddicElement: jest.fn(async () => ({ name: 'ZI_X', type: 'DDLS/DF', properties: { description: 'View X', elementProps: { sqlViewName: 'ZIX' } }, children: [{ name: 'PRODUCT', type: 'DDLS/DF', properties: { elementProps: { ddicDataType: 'CHAR', ddicLength: 40, ddicIsKey: true } } }] })),
      getObjectSource: jest.fn(async () => 'define view entity ZI_X as select from mara { key matnr as Product }'),
    };
    return { client, handler: new NavigationHandlers(client) };
  }

  it('packageTree returns the hierarchy with counts by type', async () => {
    const { handler } = make();
    const res = parse(await handler.handle('packageTree', { packageName: 'ZROOT' }));
    expect(res).toMatchObject({ packages: 2, objects: 3, byType: { 'CLAS/OC': 1, 'DDLS/DF': 1, 'PROG/P': 1 } });
    expect(res.tree.subPackages[0].package).toBe('ZSUB');
  });

  it('whereUsed resolves by name, filters result rows and rejects ambiguity', async () => {
    const { client, handler } = make();
    const res = parse(await handler.handle('whereUsed', { name: 'zcl_a' }));
    expect(client.usageReferences).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_a');
    expect(res.totalReferences).toBe(1);
    expect(res.references[0]).toMatchObject({ object: 'ZREP', usage: 'reference' });
    await expect(handler.handle('whereUsed', { name: 'NOPE' })).rejects.toThrow(/No object named NOPE/);
    await expect(handler.handle('whereUsed', { name: 'DUP' })).rejects.toThrow(/ambiguous/);
  });

  it('cdsViewInfo combines element info and source', async () => {
    const { client, handler } = make();
    const res = parse(await handler.handle('cdsViewInfo', { name: 'zi_x' }));
    expect(client.ddicElement).toHaveBeenCalledWith('ZI_X', false, false, false);
    expect(client.getObjectSource).toHaveBeenCalledWith('/sap/bc/adt/ddic/ddl/sources/zi_x/source/main');
    expect(res).toMatchObject({ name: 'ZI_X', sqlViewName: 'ZIX', fields: 1 });
    expect(res.elements[0]).toMatchObject({ name: 'PRODUCT', dataType: 'CHAR', length: 40, isKey: true });
    expect(res.source).toContain('define view entity');
    const noSrc = parse(await handler.handle('cdsViewInfo', { name: 'ZI_X', includeSource: false }));
    expect(noSrc.source).toBeUndefined();
  });
});

describe('activatePackage', () => {
  function make(inactive: any[], success = true) {
    const client: any = {
      nodeContents,
      inactiveObjects: jest.fn(async () => inactive.map(o => ({ object: o }))),
      activate: jest.fn(async () => { inactive.splice(0, inactive.length); return { success, messages: success ? [] : [{ type: 'E', shortText: 'boom' }], inactive: [] }; }),
    };
    return { client, handler: new ObjectManagementHandlers(client) };
  }
  const rec = (name: string, uri: string, parentUri: string, type = 'CLAS/OC') => ({ 'adtcore:name': name, 'adtcore:uri': uri, 'adtcore:parentUri': parentUri, 'adtcore:type': type, user: 'DEV', deleted: false });

  it('activates only the inactive objects of the package tree and reports what remains', async () => {
    const { client, handler } = make([
      rec('ZCL_A', '/sap/bc/adt/oo/classes/zcl_a', '/sap/bc/adt/packages/zroot'),
      rec('ZREP', '/sap/bc/adt/programs/programs/zrep', '/sap/bc/adt/packages/zsub', 'PROG/P'),
      rec('ZCL_A_TEST', '/sap/bc/adt/oo/classes/zcl_a/includes/testclasses', '/sap/bc/adt/oo/classes/zcl_a', 'CLAS/OCI'),
      rec('OTHER', '/sap/bc/adt/oo/classes/other', '/sap/bc/adt/packages/elsewhere'),
    ]);
    const res = parse(await handler.handle('activatePackage', { packageName: 'ZROOT' }));
    expect(client.activate).toHaveBeenCalledTimes(1);
    expect(client.activate.mock.calls[0][0].map((o: any) => o['adtcore:name'])).toEqual(['ZCL_A', 'ZREP', 'ZCL_A_TEST']);
    expect(res).toMatchObject({ status: 'success', packages: ['ZROOT', 'ZSUB'], success: true, stillInactive: [] });
  });

  it('is a no-op when nothing is inactive and flags activation failures', async () => {
    const { client, handler } = make([]);
    const res = parse(await handler.handle('activatePackage', { packageName: 'ZROOT' }));
    expect(res).toMatchObject({ activated: 0 });
    expect(client.activate).not.toHaveBeenCalled();
    const failing = make([rec('ZCL_A', '/sap/bc/adt/oo/classes/zcl_a', '/sap/bc/adt/packages/zroot')], false);
    const r = await failing.handler.handle('activatePackage', { packageName: 'ZROOT', recursive: false });
    expect(r.isError).toBe(true);
    expect(parse(r).messages[0].shortText).toBe('boom');
  });
});

describe('objectDiff', () => {
  function make() {
    const revs = [
      { uri: '/rev/1', date: '2026-01-01T00:00:00', author: 'A', version: 'DEVK900001', versionTitle: 'first' },
      { uri: '/rev/3', date: '2026-03-01T00:00:00', author: 'C', version: 'DEVK900003', versionTitle: 'third' },
      { uri: '/rev/2', date: '2026-02-01T00:00:00', author: 'B', version: 'DEVK900002', versionTitle: 'second' },
    ];
    const sources: Record<string, string> = { '/rev/1': 'a\nb\nc\n', '/rev/2': 'a\nB\nc\n', '/rev/3': 'a\nB\nc\nd\n' };
    const client: any = { revisions: jest.fn(async () => revs), getObjectSource: jest.fn(async (u: string) => sources[u]) };
    return { client, handler: new RevisionHandlers(client) };
  }

  it('diffs the newest against the previous revision by default', async () => {
    const { handler } = make();
    const res = parse(await handler.handle('objectDiff', { objectUrl: '/sap/bc/adt/oo/classes/zcl_a' }));
    expect(res.to.version).toBe('DEVK900003');
    expect(res.from.version).toBe('DEVK900002');
    expect(res).toMatchObject({ linesAdded: 1, linesRemoved: 0, identical: false, revisions: 3 });
    expect(res.diff).toContain('+d');
  });

  it('selects revisions by index, version or uri and validates them', async () => {
    const { handler } = make();
    const byVersion = parse(await handler.handle('objectDiff', { objectUrl: '/o', fromRevision: 'DEVK900001', toRevision: '/rev/2' }));
    expect(byVersion).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    const byIndex = parse(await handler.handle('objectDiff', { objectUrl: '/o', fromRevision: '2', toRevision: '2' }));
    expect(byIndex.identical).toBe(true);
    await expect(handler.handle('objectDiff', { objectUrl: '/o', fromRevision: '9' })).rejects.toThrow(/out of range/);
    await expect(handler.handle('objectDiff', { objectUrl: '/o', fromRevision: 'nope' })).rejects.toThrow(/not found/);
  });
});

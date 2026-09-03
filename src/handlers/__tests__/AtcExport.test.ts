import fs from 'fs';
import os from 'os';
import path from 'path';
import { summarizeAtcWorklist, AtcHandlers } from '../AtcHandlers';
import { NavigationHandlers } from '../NavigationHandlers';
import { abapgitFileName, resolveExportDir } from '../../lib/abapgitExport';

const parse = (r: any) => JSON.parse(r.content[0].text);
const f = (priority: number, checkId: string, msg: string, extra: any = {}) => ({ uri: '/u', location: { range: { start: { line: 12 } } }, priority, checkId, checkTitle: `Check ${checkId}`, messageId: 'M1', messageTitle: msg, exemptionApproval: '', exemptionKind: 'none', quickfixInfo: undefined, link: {}, ...extra });
const WORKLIST = {
  id: 'WL1', timestamp: 1, usedObjectSet: 'ALL', objectSetIsComplete: true, objectSets: [],
  objects: [
    { uri: '/a', type: 'CLAS/OC', name: 'ZCL_A', packageName: 'ZPKG', author: 'DEV', findings: [f(1, 'SEC', 'SQL injection', { quickfixInfo: 'qf' }), f(3, 'STYLE', 'Naming')] },
    { uri: '/b', type: 'PROG/P', name: 'ZREP', packageName: 'ZPKG', author: 'DEV', findings: [f(2, 'PERF', 'Select in loop'), f(3, 'STYLE', 'Naming', { exemptionKind: 'inline' })] },
    { uri: '/c', type: 'INTF/OI', name: 'ZIF_C', packageName: 'ZPKG', author: 'DEV', findings: [] },
  ]
};

describe('atcSummary', () => {
  it('aggregates by priority, check and object', () => {
    const s = summarizeAtcWorklist(WORKLIST, 2);
    expect(s.totals).toEqual({ objectsChecked: 3, objectsWithFindings: 2, findings: 4, exempted: 1, quickfixable: 1 });
    expect(s.byPriority).toEqual({ '1': 1, '2': 1, '3': 2 });
    expect(s.byCheck.map(c => [c.checkId, c.count, c.worstPriority])).toEqual([['SEC', 1, 1], ['PERF', 1, 2], ['STYLE', 2, 3]]);
    expect(s.byObject[0]).toMatchObject({ name: 'ZCL_A', p1: 1, findings: 2 });
    expect(s.topFindings).toHaveLength(2);
    expect(s.topFindings[0]).toMatchObject({ priority: 1, object: 'ZCL_A', line: 12, quickfix: true });
    expect(s.clean).toBe(false);
    expect(summarizeAtcWorklist({ objects: [] }).clean).toBe(true);
  });

  it('runs ATC first when only mainUrl is given', async () => {
    const client: any = {
      atcCheckVariant: jest.fn(async () => 'A'.repeat(32)),
      createAtcRun: jest.fn(async () => ({ id: 'RUN1', timestamp: 1, infos: [] })),
      atcWorklists: jest.fn(async () => WORKLIST),
    };
    const h = new AtcHandlers(client);
    const res = parse(await h.handle('atcSummary', { mainUrl: '/sap/bc/adt/packages/zpkg' }));
    expect(client.atcCheckVariant).toHaveBeenCalledWith('ABAP_CLOUD_DEVELOPMENT_DEFAULT');
    expect(client.createAtcRun).toHaveBeenCalledWith('A'.repeat(32), '/sap/bc/adt/packages/zpkg', undefined);
    expect(res.runResultId).toBe('RUN1');
    expect(res.totals.findings).toBe(4);
    await expect(h.handle('atcSummary', {})).rejects.toThrow(/runResultId/);
  });
});

describe('exportPackageSources', () => {
  it('maps names to abapGit files and guards the target directory', () => {
    expect(abapgitFileName('ZCL_A', 'CLAS/OC')).toBe('zcl_a.clas.abap');
    expect(abapgitFileName('ZCL_A', 'CLAS/OC', 'testclasses')).toBe('zcl_a.clas.testclasses.abap');
    expect(abapgitFileName('/ACME/ZI_X', 'DDLS/DF')).toBe('#acme#zi_x.ddls.asddls');
    expect(abapgitFileName('ZTAB', 'TABL/DT')).toBeUndefined();
    expect(() => resolveExportDir('relative/dir', undefined)).toThrow(/absolute/);
    expect(() => resolveExportDir('/tmp/x', '/srv/exports')).toThrow(/MCP_EXPORT_ROOT/);
    expect(resolveExportDir('/srv/exports/a', '/srv/exports')).toBe('/srv/exports/a');
  });

  it('writes sources and class includes in abapGit layout with a manifest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    const client: any = {
      nodeContents: jest.fn(async (_t: string, name: string) => ({ nodes: name === 'ZPKG' ? [
        { OBJECT_TYPE: 'CLAS/OC', OBJECT_NAME: 'ZCL_A', OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_a' },
        { OBJECT_TYPE: 'DDLS/DF', OBJECT_NAME: 'ZI_X', OBJECT_URI: '/sap/bc/adt/ddic/ddl/sources/zi_x' },
        { OBJECT_TYPE: 'TABL/DT', OBJECT_NAME: 'ZTAB', OBJECT_URI: '/sap/bc/adt/ddic/tables/ztab' },
      ] : [], categories: [], objectTypes: [] })),
      getObjectSource: jest.fn(async (url: string) => {
        if (url.endsWith('zcl_a/source/main')) return 'CLASS zcl_a DEFINITION.';
        if (url.endsWith('zcl_a/includes/testclasses')) return 'CLASS ltc DEFINITION FOR TESTING.';
        if (url.endsWith('zcl_a/includes/implementations')) return '';
        if (url.endsWith('zi_x/source/main')) return 'define view entity ZI_X as select from t000 { mandt }';
        throw new Error('Request failed with status code 404');
      }),
    };
    const h = new NavigationHandlers(client);
    const res = parse(await h.handle('exportPackageSources', { packageName: 'zpkg', targetDir: dir }));
    expect(res).toMatchObject({ status: 'success', filesWritten: 3, objects: 3 });
    expect(res.skipped).toEqual([{ object: 'ZTAB', type: 'TABL/DT', reason: 'type not exportable' }]);
    const files = fs.readdirSync(path.join(dir, 'zpkg')).sort();
    expect(files).toEqual(['zcl_a.clas.abap', 'zcl_a.clas.testclasses.abap', 'zi_x.ddls.asddls']);
    expect(fs.readFileSync(path.join(dir, 'zpkg', 'zi_x.ddls.asddls'), 'utf8')).toContain('define view entity');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'EXPORT.json'), 'utf8'));
    expect(manifest).toMatchObject({ package: 'ZPKG', files: 3, packages: ['ZPKG'] });
    await expect(h.handle('exportPackageSources', { packageName: 'ZPKG', targetDir: 'nope' })).rejects.toThrow(/absolute/);
  });
});

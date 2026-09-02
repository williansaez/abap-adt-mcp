import { evaluatePolicy, parsePolicy, globMatch, objectUrlOf, tablesInSql, summarizePolicy } from '../policy';
import { readSystems } from '../systems';

const ctx = (pkgs: Record<string, string | undefined> = {}) => ({
  resolvePackage: jest.fn(async (url: string) => pkgs[url])
});

describe('policy helpers', () => {
  it('globs case-insensitively', () => {
    expect(globMatch('Z*', 'zcl_demo')).toBe(true);
    expect(globMatch('$*', '$TMP')).toBe(true);
    expect(globMatch('DEVK9??123', 'DEVK900123')).toBe(true);
    expect(globMatch('Z*', 'YCL')).toBe(false);
  });
  it('normalizes object urls and extracts tables from SQL', () => {
    expect(objectUrlOf('/sap/bc/adt/oo/classes/zcl_x/source/main#start=1')).toBe('/sap/bc/adt/oo/classes/zcl_x');
    expect(objectUrlOf('/sap/bc/adt/oo/classes/zcl_x/includes/testclasses')).toBe('/sap/bc/adt/oo/classes/zcl_x');
    expect(tablesInSql('select a from pa0002 as p inner join usr02 on p.x = usr02.y')).toEqual(['PA0002', 'USR02']);
  });
  it('parses policy blocks leniently and ignores empty ones', () => {
    expect(parsePolicy({ readOnly: 'yes', deniedTools: 'git*, transportRelease' })).toEqual({ readOnly: true, deniedTools: ['git*', 'transportRelease'], allowFreeSql: undefined, deniedTables: undefined, allowedPackages: undefined, allowedTransports: undefined });
    expect(parsePolicy({})).toBeUndefined();
    expect(summarizePolicy({ readOnly: true, deniedTools: undefined })).toEqual({ readOnly: true });
  });
});

describe('evaluatePolicy gates', () => {
  it('allows everything without a policy', async () => {
    expect(await evaluatePolicy(undefined, 'deleteObject', {}, ctx())).toEqual({ allowed: true });
  });

  it('readOnly blocks writes but keeps reads and session tools', async () => {
    const p = { readOnly: true };
    expect((await evaluatePolicy(p, 'setObjectSource', {}, ctx())).gate).toBe('readOnly');
    expect((await evaluatePolicy(p, 'lock', {}, ctx())).gate).toBe('readOnly');
    expect((await evaluatePolicy(p, 'getObjectSource', {}, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'login', {}, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'systemProfile', {}, ctx())).allowed).toBe(true);
  });

  it('deniedTools uses globs', async () => {
    const p = { deniedTools: ['git*', 'transportRelease'] };
    expect((await evaluatePolicy(p, 'gitPullRepo', {}, ctx())).gate).toBe('deniedTools');
    expect((await evaluatePolicy(p, 'transportRelease', {}, ctx())).gate).toBe('deniedTools');
    expect((await evaluatePolicy(p, 'transportInfo', {}, ctx())).allowed).toBe(true);
  });

  it('allowFreeSql=false blocks runQuery and SQL through tableContents', async () => {
    const p = { allowFreeSql: false };
    expect((await evaluatePolicy(p, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).gate).toBe('allowFreeSql');
    expect((await evaluatePolicy(p, 'tableContents', { ddicEntityName: 'T000', sqlQuery: 'x' }, ctx())).gate).toBe('allowFreeSql');
    expect((await evaluatePolicy(p, 'tableContents', { ddicEntityName: 'T000' }, ctx())).allowed).toBe(true);
  });

  it('deniedTables covers direct reads and SQL joins', async () => {
    const p = { deniedTables: ['PA*', 'USR02'] };
    expect((await evaluatePolicy(p, 'tableContents', { ddicEntityName: 'pa0008' }, ctx())).reason).toMatch(/PA0008/);
    expect((await evaluatePolicy(p, 'runQuery', { sqlQuery: 'select * from t000 join usr02 on 1=1' }, ctx())).gate).toBe('deniedTables');
    expect((await evaluatePolicy(p, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).allowed).toBe(true);
  });

  it('allowedPackages checks createObject, resolved object packages and change-package targets, closed on unknown', async () => {
    const p = { allowedPackages: ['Z*', '$*'] };
    const c = ctx({ '/sap/bc/adt/oo/classes/zcl_ok': 'ZPKG', '/sap/bc/adt/oo/classes/cl_std': 'SABP', '/sap/bc/adt/oo/classes/zcl_tmp': '$TMP' });
    expect((await evaluatePolicy(p, 'createObject', { parentName: 'ZDEV' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'createObject', { parentName: 'SAPBC' }, c)).gate).toBe('allowedPackages');
    expect((await evaluatePolicy(p, 'setObjectSource', { objectSourceUrl: '/sap/bc/adt/oo/classes/zcl_ok/source/main' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'editObjectSource', { objectSourceUrl: '/sap/bc/adt/oo/classes/cl_std/source/main' }, c)).reason).toMatch(/SABP/);
    expect((await evaluatePolicy(p, 'deleteObject', { objectUrl: '/sap/bc/adt/oo/classes/zcl_tmp' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'lock', { objectUrl: '/sap/bc/adt/oo/classes/unknown' }, c)).reason).toMatch(/could not determine/);
    expect((await evaluatePolicy(p, 'createTestInclude', { clas: 'ZCL_OK' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'changePackageExecute', { refactoring: JSON.stringify({ newPackage: 'SAPX' }) }, c)).gate).toBe('allowedPackages');
    expect((await evaluatePolicy(p, 'getObjectSource', { objectSourceUrl: '/sap/bc/adt/oo/classes/cl_std/source/main' }, c)).allowed).toBe(true);
  });

  it('allowedTransports restricts transport arguments and forbids creating new ones', async () => {
    const p = { allowedTransports: ['DEVK9*'] };
    expect((await evaluatePolicy(p, 'setObjectSource', { transport: 'DEVK900001' }, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'setObjectSource', { transport: 'QASK900001' }, ctx())).gate).toBe('allowedTransports');
    expect((await evaluatePolicy(p, 'transportRelease', { transportNumber: 'QASK900001' }, ctx())).gate).toBe('allowedTransports');
    expect((await evaluatePolicy(p, 'createTransport', {}, ctx())).gate).toBe('allowedTransports');
    expect((await evaluatePolicy(p, 'resolveTransport', { objSourceUrl: '/x', createIfMissing: true }, ctx())).gate).toBe('allowedTransports');
    expect((await evaluatePolicy(p, 'resolveTransport', { objSourceUrl: '/x' }, ctx())).allowed).toBe(true);
  });
});

describe('systems.json policy parsing', () => {
  it('reads a policy block and applies MCP_READ_ONLY globally', () => {
    const env = {
      SAP_SYSTEMS: JSON.stringify({
        DEV: { url: 'https://dev', authType: 'basic', user: 'u', password: 'p', policy: { allowedPackages: ['Z*'], deniedTools: ['transportRelease'] } },
        PRD: { url: 'https://prd', authType: 'basic', user: 'u', password: 'p', policy: { readOnly: true } },
        QAS: { url: 'https://qas', authType: 'basic', user: 'u', password: 'p' },
      })
    } as any;
    const systems = readSystems(env);
    expect(systems.get('DEV')!.policy).toMatchObject({ allowedPackages: ['Z*'], deniedTools: ['transportRelease'] });
    expect(systems.get('PRD')!.policy).toMatchObject({ readOnly: true });
    expect(systems.get('QAS')!.policy).toBeUndefined();
    const ro = readSystems({ ...env, MCP_READ_ONLY: '1' });
    expect(ro.get('QAS')!.policy).toEqual({ readOnly: true });
    expect(ro.get('DEV')!.policy).toMatchObject({ readOnly: true, allowedPackages: ['Z*'] });
  });
});

import { refactoringTransports, evaluatePolicy, parsePolicy, globMatch, objectUrlOf, tablesInSql, summarizePolicy, dataAccess } from '../policy';
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
  it('allows everything but data reads without a policy', async () => {
    expect(await evaluatePolicy(undefined, 'deleteObject', {}, ctx())).toEqual({ allowed: true });
    expect(await evaluatePolicy(undefined, 'getObjectSource', {}, ctx())).toEqual({ allowed: true });
    expect(await evaluatePolicy(undefined, 'ddicElement', { path: 'MARA' }, ctx())).toEqual({ allowed: true });
  });

  it('keeps table data and free SQL closed until the destination opens them', async () => {
    const preview = await evaluatePolicy(undefined, 'tableContents', { ddicEntityName: 'T000' }, ctx());
    expect(preview).toMatchObject({ allowed: false, gate: 'allowDataPreview' });
    expect(preview.reason).toMatch(/"allowDataPreview": true/);
    expect(preview.reason).toMatch(/MCP_ALLOW_DATA_PREVIEW=1/);
    const sql = await evaluatePolicy({}, 'runQuery', { sqlQuery: 'select * from t000' }, ctx());
    expect(sql).toMatchObject({ allowed: false, gate: 'allowFreeSql' });
    expect(sql.reason).toMatch(/"allowFreeSql": true/);
    // No alternative is offered that is closed as well.
    expect(sql.reason).not.toMatch(/tableContents without sqlQuery/);
    // A policy written for other gates does not open data by accident.
    expect((await evaluatePolicy({ allowedPackages: ['Z*'] }, 'tableContents', { ddicEntityName: 'T000' }, ctx())).gate).toBe('allowDataPreview');
  });

  it('opens table data and free SQL separately, free SQL implying table data', async () => {
    const preview = { allowDataPreview: true };
    expect((await evaluatePolicy(preview, 'tableContents', { ddicEntityName: 'T000' }, ctx())).allowed).toBe(true);
    const refused = await evaluatePolicy(preview, 'runQuery', { sqlQuery: 'select * from t000' }, ctx());
    expect(refused.gate).toBe('allowFreeSql');
    expect(refused.reason).toMatch(/tableContents without sqlQuery/);
    expect((await evaluatePolicy(preview, 'tableContents', { ddicEntityName: 'T000', sqlQuery: 'select * from t000' }, ctx())).gate).toBe('allowFreeSql');

    const sql = { allowFreeSql: true };
    expect((await evaluatePolicy(sql, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy(sql, 'tableContents', { ddicEntityName: 'T000' }, ctx())).allowed).toBe(true);

    // An explicit false on table data closes SQL too, and says so.
    const closed = { allowDataPreview: false, allowFreeSql: true };
    expect(dataAccess(closed)).toEqual({ allowDataPreview: false, allowFreeSql: false });
    expect((await evaluatePolicy(closed, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).reason).toMatch(/"allowDataPreview": false, which closes SQL as well/);
    expect((await evaluatePolicy(closed, 'tableContents', { ddicEntityName: 'T000' }, ctx())).reason).toMatch(/states "allowDataPreview": false/);
    expect(dataAccess(undefined)).toEqual({ allowDataPreview: false, allowFreeSql: false });
    expect(dataAccess(sql)).toEqual({ allowDataPreview: true, allowFreeSql: true });
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
    // The trap the old docs example set: five abapGit tools are not git-prefixed.
    expect((await evaluatePolicy(p, 'pushRepo', {}, ctx())).allowed).toBe(true);
  });

  it('deniedTools accepts toolset:<name> for every tool of a toolset', async () => {
    const p = { deniedTools: ['toolset:git', 'toolset:rap'] };
    for (const t of ['gitPullRepo', 'pushRepo', 'stageRepo', 'checkRepo', 'remoteRepoInfo', 'switchRepoBranch', 'rapGenGenerate']) {
      expect((await evaluatePolicy(p, t, {}, ctx())).gate).toBe('deniedTools');
    }
    expect((await evaluatePolicy(p, 'getObjectSource', {}, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy({ deniedTools: ['toolset:g*'] }, 'pushRepo', {}, ctx())).gate).toBe('deniedTools');
    expect((await evaluatePolicy({ deniedTools: ['toolset:nosuch'] }, 'pushRepo', {}, ctx())).allowed).toBe(true);
  });

  it('allowedTransports reads the transport inside refactoring proposals', async () => {
    const p = { allowedTransports: ['DEVK9*'] };
    const ok = { transport: 'DEVK900123', affectedObjects: [{ transport: 'DEVK900123' }] };
    expect((await evaluatePolicy(p, 'renameExecute', { refactoring: ok }, ctx())).allowed).toBe(true);
    expect((await evaluatePolicy(p, 'extractMethodExecute', { refactoring: JSON.stringify(ok) }, ctx())).allowed).toBe(true);
    // Wrong transport, as object and as JSON string.
    expect((await evaluatePolicy(p, 'renameExecute', { refactoring: { transport: 'QASK900001' } }, ctx()))).toMatchObject({ gate: 'allowedTransports' });
    expect((await evaluatePolicy(p, 'changePackageExecute', { refactoring: JSON.stringify({ transport: 'QASK900001' }) }, ctx())).gate).toBe('allowedTransports');
    // A wrong transport hidden in affectedObjects.
    expect((await evaluatePolicy(p, 'renameExecute', { refactoring: { transport: 'DEVK900123', affectedObjects: [{ transport: 'QASK900001' }] } }, ctx())).gate).toBe('allowedTransports');
    // No transport at all: closed mode refuses.
    expect((await evaluatePolicy(p, 'renameExecute', { refactoring: { transport: '' } }, ctx())).gate).toBe('allowedTransports');
    expect((await evaluatePolicy(p, 'extractMethodExecute', {}, ctx())).gate).toBe('allowedTransports');
    // Preview tools stay open (they carry the transport as a top-level argument, gated by TRANSPORT_ARGS).
    expect((await evaluatePolicy(p, 'renamePreview', { refactoring: { transport: '' } }, ctx())).allowed).toBe(true);
    expect(refactoringTransports('not json')).toEqual([]);
    expect(refactoringTransports({ transport: 'devk900123', affectedObjects: [{}, { transport: 'DEVK900123' }] })).toEqual(['DEVK900123']);
  });

  it('allowFreeSql=false blocks runQuery and SQL through tableContents', async () => {
    const p = { allowDataPreview: true, allowFreeSql: false };
    expect((await evaluatePolicy(p, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).gate).toBe('allowFreeSql');
    expect((await evaluatePolicy(p, 'runQuery', { sqlQuery: 'select * from t000' }, ctx())).reason).toMatch(/states "allowFreeSql": false/);
    expect((await evaluatePolicy(p, 'tableContents', { ddicEntityName: 'T000', sqlQuery: 'x' }, ctx())).gate).toBe('allowFreeSql');
    expect((await evaluatePolicy(p, 'tableContents', { ddicEntityName: 'T000' }, ctx())).allowed).toBe(true);
    // allowFreeSql: false alone no longer leaves table data open.
    expect((await evaluatePolicy({ allowFreeSql: false }, 'tableContents', { ddicEntityName: 'T000' }, ctx())).gate).toBe('allowDataPreview');
  });

  it('deniedTables covers direct reads and SQL joins', async () => {
    const p = { allowFreeSql: true, deniedTables: ['PA*', 'USR02'] };
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

  it('applies MCP_ALLOW_DATA_PREVIEW and MCP_ALLOW_FREE_SQL only where the destination is silent', () => {
    const env = {
      SAP_SYSTEMS: JSON.stringify({
        DEV: { url: 'https://dev', authType: 'basic', user: 'u', password: 'p' },
        QAS: { url: 'https://qas', authType: 'basic', user: 'u', password: 'p', policy: { allowFreeSql: false, deniedTables: ['USR02'] } },
        PRD: { url: 'https://prd', authType: 'basic', user: 'u', password: 'p', policy: { allowDataPreview: false } },
      })
    } as any;
    const closed = readSystems(env);
    expect(dataAccess(closed.get('DEV')!.policy)).toEqual({ allowDataPreview: false, allowFreeSql: false });

    const preview = readSystems({ ...env, MCP_ALLOW_DATA_PREVIEW: '1' });
    expect(dataAccess(preview.get('DEV')!.policy)).toEqual({ allowDataPreview: true, allowFreeSql: false });
    expect(dataAccess(preview.get('QAS')!.policy)).toEqual({ allowDataPreview: true, allowFreeSql: false });
    expect(preview.get('QAS')!.policy).toMatchObject({ deniedTables: ['USR02'] });
    expect(dataAccess(preview.get('PRD')!.policy)).toEqual({ allowDataPreview: false, allowFreeSql: false });

    const sql = readSystems({ ...env, MCP_ALLOW_FREE_SQL: 'true' });
    expect(dataAccess(sql.get('DEV')!.policy)).toEqual({ allowDataPreview: true, allowFreeSql: true });
    expect(dataAccess(sql.get('QAS')!.policy)).toEqual({ allowDataPreview: false, allowFreeSql: false });
    expect(dataAccess(sql.get('PRD')!.policy)).toEqual({ allowDataPreview: false, allowFreeSql: false });
  });

  it('covers activatePackage, activateObjects, createObject parentPath, refactorings and unresolvable writes under allowedPackages', async () => {
    const policy = { allowedPackages: ['Z*'] };
    const c = ctx({ '/sap/bc/adt/oo/classes/zcl_ok': 'ZOK', '/sap/bc/adt/oo/classes/ycl_no': 'YNO' });
    expect((await evaluatePolicy(policy, 'activatePackage', { packageName: 'ZFIN' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(policy, 'activatePackage', { packageName: 'YFIN' }, c)).allowed).toBe(false);
    expect((await evaluatePolicy(policy, 'activateObjects', { objects: JSON.stringify([{ 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_ok' }]) }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(policy, 'activateObjects', { objects: [{ uri: '/sap/bc/adt/oo/classes/ycl_no' }] }, c))).toMatchObject({ allowed: false, gate: 'allowedPackages' });
    expect((await evaluatePolicy(policy, 'activateObjects', { objects: [{ uri: '/sap/bc/adt/oo/classes/unknown' }] }, c)).allowed).toBe(false);
    expect((await evaluatePolicy(policy, 'createObject', { parentPath: '/sap/bc/adt/packages/zfin' }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(policy, 'createObject', { parentPath: '/sap/bc/adt/packages/yfin' }, c)).allowed).toBe(false);
    expect((await evaluatePolicy(policy, 'renameExecute', { refactoring: { adtObjectUri: { uri: '/sap/bc/adt/oo/classes/zcl_ok/source/main' } } }, c)).allowed).toBe(true);
    expect((await evaluatePolicy(policy, 'extractMethodExecute', { refactoring: JSON.stringify({ affectedObjects: [{ uri: '/sap/bc/adt/oo/classes/ycl_no' }] }) }, c)).allowed).toBe(false);
    expect((await evaluatePolicy(policy, 'gitPullRepo', { repoId: 'x' }, c))).toMatchObject({ allowed: false, gate: 'allowedPackages' });
    expect((await evaluatePolicy({ deniedTables: ['PA*'] }, 'runSnippet', { code: 'SELECT * FROM pa0002 INTO TABLE @DATA(lt).' }, c))).toMatchObject({ allowed: false, gate: 'deniedTables' });
    expect((await evaluatePolicy({ readOnly: true }, 'exportPackageSources', { packageName: 'ZX', targetDir: '/tmp' }, c)).allowed).toBe(true);
  });
});

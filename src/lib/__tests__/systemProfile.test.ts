import { buildSystemProfile, detectFeatures, collectionHrefs, parseSystemInformation } from '../systemProfile';

// Collection hrefs observed on a live S/4HANA Public Cloud tenant (subset).
const CLOUD_HREFS = [
  '/sap/bc/adt/debugger', '/sap/bc/adt/debugger/breakpoints', '/sap/bc/adt/runtime/traces/abaptraces',
  '/sap/bc/adt/abapgit/repos', '/sap/bc/adt/abapgit/externalrepoinfo', '/sap/bc/adt/atc/runs', '/sap/bc/adt/atc/worklists',
  '/sap/bc/adt/repository/informationsystem/textsearch', '/sap/bc/adt/apireleases', '/sap/bc/adt/system/information',
  '/sap/bc/adt/feeds', '/sap/bc/adt/datapreview/freestyle', '/sap/bc/adt/abapunit/testruns', '/sap/bc/adt/refactorings',
  '/sap/bc/adt/packages', '/sap/bc/adt/checkruns', '/sap/bc/adt/businessservices/bindings', '/sap/bc/adt/oo/classes',
];
const discovery = (hrefs: string[]) => [{ title: 'ws', collection: hrefs.map(href => ({ href, templateLinks: [] })) }];
const toolsOf = (ts: string) => ({ debugger: ['debuggerStep'], traces: ['tracesList'], rap: ['rapGenGenerate'], git: ['gitPullRepo'] } as any)[ts] || [];

describe('systemProfile', () => {
  it('reads collection hrefs from the discovery document', () => {
    expect(collectionHrefs(discovery(CLOUD_HREFS)).size).toBe(CLOUD_HREFS.length);
    expect(collectionHrefs({ discovery: discovery(['/a']) }).has('/a')).toBe(true);
  });

  it('detects features by collection prefix', () => {
    const f = detectFeatures(new Set(CLOUD_HREFS));
    expect(f).toMatchObject({ debugger: true, traces: true, abapGit: true, atc: true, textSearch: true, apiReleases: true, rapGenerator: false, systemInformation: true });
  });

  it('marks a cloud tenant by host and lists the toolsets it cannot serve', () => {
    const p = buildSystemProfile({
      destination: 'DEV', url: 'https://my100001.s4hana.cloud.sap', client: '080', authType: 'sso',
      discovery: discovery(CLOUD_HREFS), toolsOfToolset: toolsOf, now: '2026-09-02T00:00:00Z'
    });
    expect(p.platform).toBe('cloud');
    expect(p.unavailableToolsets).toEqual(['rap']);
    expect(p.unavailableTools).toEqual(['rapGenGenerate']);
    expect(p.collections).toBe(CLOUD_HREFS.length);
    expect(p.builtAt).toBe('2026-09-02T00:00:00Z');
  });

  it('marks an on-prem host and reports missing collections', () => {
    const p = buildSystemProfile({
      destination: 'ECC', url: 'https://sap.example.com:44300', authType: 'basic',
      discovery: discovery(['/sap/bc/adt/oo/classes', '/sap/bc/adt/atc/runs', '/sap/bc/adt/abapunit/testruns']), toolsOfToolset: toolsOf
    });
    expect(p.platform).toBe('onprem');
    expect(p.unavailableToolsets).toEqual(expect.arrayContaining(['debugger', 'traces', 'git', 'rap']));
    expect(p.unavailableTools).toEqual(expect.arrayContaining(['debuggerStep', 'tracesList', 'gitPullRepo']));
  });

  it('parses system information leniently from XML or JSON', () => {
    expect(parseSystemInformation('{"systemId":"CZ0","release":"2508"}')).toEqual({ systemId: 'CZ0', release: '2508' });
    expect(parseSystemInformation('<sysinfo:info xmlns:sysinfo="x" sysinfo:sid="CZ0"><sysinfo:release>2508</sysinfo:release></sysinfo:info>')).toMatchObject({ sid: 'CZ0', release: '2508' });
    expect(parseSystemInformation('')).toBeUndefined();
    expect(parseSystemInformation('<?xml version="1.0" encoding="utf-8"?><feed><title>System Information</title></feed>')).toEqual({ title: 'System Information' });
  });
});

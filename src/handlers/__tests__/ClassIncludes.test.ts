import { classIncludeUrls } from '../ClassHandlers';

const include = (includeType: string, links: any[], sourceUri?: string) =>
  ({ 'class:includeType': includeType, 'abapsource:sourceUri': sourceUri, links } as any);
const clas = (includes: any[]) => ({ objectUrl: '/sap/bc/adt/oo/classes/zcl_demo', includes, links: [], metaData: {} } as any);

describe('classIncludeUrls', () => {
  it('uses the text/plain link where the system types it', () => {
    const urls = classIncludeUrls(clas([
      include('main', [{ href: 'source/main', rel: 'http://www.sap.com/adt/relations/source', type: 'text/plain' }]),
      include('testclasses', [{ href: 'includes/testclasses', rel: 'http://www.sap.com/adt/relations/source', type: 'text/plain' }])
    ]));
    expect(Object.fromEntries(urls)).toEqual({
      main: '/sap/bc/adt/oo/classes/zcl_demo/source/main',
      testclasses: '/sap/bc/adt/oo/classes/zcl_demo/includes/testclasses'
    });
  });

  it('falls back to the source rel on SAP_BASIS 7.40, whose links carry no type', () => {
    // Shape of ZCL_MCP_RFC_TEST on P03 (7.40 SP07), where ADTClient.classIncludes threw on mainLink.href.
    const urls = classIncludeUrls(clas([
      include('definitions', [
        { href: 'includes/definitions/versions', rel: 'http://www.sap.com/adt/relations/versions' },
        { href: 'includes/definitions', rel: 'http://www.sap.com/adt/relations/source', etag: '202610091913350011' }
      ], 'includes/definitions'),
      include('main', [
        { href: 'includes/main/versions', rel: 'http://www.sap.com/adt/relations/versions' },
        { href: 'source/main', rel: 'http://www.sap.com/adt/relations/source' }
      ], 'source/main')
    ]));
    expect(urls.get('definitions')).toBe('/sap/bc/adt/oo/classes/zcl_demo/includes/definitions');
    expect(urls.get('main')).toBe('/sap/bc/adt/oo/classes/zcl_demo/source/main');
  });

  it('uses abapsource:sourceUri when no link names the source', () => {
    const urls = classIncludeUrls(clas([include('macros', [], 'includes/macros')]));
    expect(urls.get('macros')).toBe('/sap/bc/adt/oo/classes/zcl_demo/includes/macros');
  });
});

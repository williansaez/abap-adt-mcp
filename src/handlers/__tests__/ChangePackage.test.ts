import { changePackagePreview } from 'abap-adt-api/build/api/refactor';
import { RefactorHandlers } from '../RefactorHandlers';

// Real abap-adt-api serializer behind a fake HTTP layer that records the body and stops there.
function make(meta: any) {
  const sent: any[] = [];
  const h: any = { request: jest.fn(async (_url: string, opts: any) => { sent.push(opts); throw new Error('stop after sending'); }) };
  const client: any = {
    objectStructure: jest.fn(async () => ({ metaData: meta })),
    changePackagePreview: (p: any, t: string) => changePackagePreview(h, p, t)
  };
  return { sent, handler: new RefactorHandlers(client) };
}
const ARGS = { objectUrl: '/sap/bc/adt/programs/programs/zmcp_rfc_prog', oldPackage: '$TMP', newPackage: 'ZMCP_RFC_PROG', transport: 'P03K901865' };

describe('changePackagePreview', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));

  it('sends the affected object with its name and type (it threw before any request until now)', async () => {
    const { sent, handler } = make({ 'adtcore:name': 'ZMCP_RFC_PROG', 'adtcore:type': 'PROG/P' });
    await expect(handler.handle('changePackagePreview', ARGS)).rejects.toThrow(/stop after sending/);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('adtcore:name="ZMCP_RFC_PROG"');
    expect(sent[0].body).toContain('adtcore:type="PROG/P"');
    expect(sent[0].body).toContain('<generic:newPackage>ZMCP_RFC_PROG</generic:newPackage>');
    expect(sent[0].body).toContain('<generic:transport>P03K901865</generic:transport>');
  });

  it('refuses a URL whose metadata has no name or type', async () => {
    const { sent, handler } = make({});
    await expect(handler.handle('changePackagePreview', ARGS)).rejects.toThrow(/Could not read the name and type/);
    expect(sent).toHaveLength(0);
  });
});

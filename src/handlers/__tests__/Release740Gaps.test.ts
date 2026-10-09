import { AtcHandlers } from '../AtcHandlers';
import { usageReferencesExplained } from '../../lib/usageReferences';

function makeHandler(checkVariant: () => Promise<string>) {
  const client: any = {
    atcCheckVariant: jest.fn(checkVariant),
    createAtcRun: jest.fn(async () => ({ id: 'RUN1', timestamp: 0, infos: [] }))
  };
  return { client, handler: new AtcHandlers(client) };
}

describe('ATC on a release without /sap/bc/adt/atc/worklists', () => {
  const notFound = async (): Promise<string> => { throw Object.assign(new Error('Not Found'), { status: 404 }); };

  it('says the ADT ATC flow is missing instead of a bare Not Found', async () => {
    const { client, handler } = makeHandler(notFound);
    await expect(handler.handle('createAtcRun', { variant: 'DEFAULT', mainUrl: '/sap/bc/adt/oo/classes/zcl_demo' }))
      .rejects.toThrow(/not available on this system.*SAP GUI/);
    await expect(handler.handle('atcCheckVariant', { variant: 'DEFAULT' })).rejects.toThrow(/atc\/worklists answers 404/);
    expect(client.createAtcRun).not.toHaveBeenCalled();
  });

  it('keeps the flow unchanged where the worklist resolves', async () => {
    const { client, handler } = makeHandler(async () => '0123456789ABCDEF0123456789ABCDEF');
    const r = JSON.parse((await handler.handle('createAtcRun', { variant: 'DEFAULT', mainUrl: '/sap/bc/adt/oo/classes/zcl_demo' })).content[0].text);
    expect(r.result.id).toBe('RUN1');
    expect(client.createAtcRun).toHaveBeenCalledWith('0123456789ABCDEF0123456789ABCDEF', '/sap/bc/adt/oo/classes/zcl_demo', undefined);
  });
});

describe('where-used on a release without usageReferences', () => {
  it('explains the 404 and passes other errors through', async () => {
    const missing: any = { usageReferences: jest.fn(async () => { throw Object.assign(new Error('Not Found'), { status: 404 }); }) };
    await expect(usageReferencesExplained(missing, '/sap/bc/adt/oo/classes/cl_x')).rejects.toThrow(/SAP_BASIS 7.40 and older/);
    const broken: any = { usageReferences: jest.fn(async () => { throw Object.assign(new Error('boom'), { status: 500 }); }) };
    await expect(usageReferencesExplained(broken, '/x')).rejects.toThrow('boom');
    const ok: any = { usageReferences: jest.fn(async () => [{ uri: '/a' }]) };
    await expect(usageReferencesExplained(ok, '/x', 3, 4)).resolves.toEqual([{ uri: '/a' }]);
    expect(ok.usageReferences).toHaveBeenCalledWith('/x', 3, 4);
  });
});

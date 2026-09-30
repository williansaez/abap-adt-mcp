import { createObject as libraryCreateObject } from 'abap-adt-api/build/api/objectcreator';
import { ObjectRegistrationHandlers } from '../ObjectRegistrationHandlers';
import { SnippetHandlers } from '../SnippetHandlers';
import { session_types } from 'abap-adt-api';
import { recordLock, clearLedger } from '../../lib/lockLedger';

// A client that builds the request the way abap-adt-api does, so the test sees the XML SAP would receive.
function make(language?: string) {
  const request = jest.fn(async (_url: string, _config: any) => ({ status: 201, body: '' }));
  const h: any = { request, username: 'DEVELOPER' };
  const client: any = {
    language,
    stateful: 'stateless',
    createObject: jest.fn(async (...args: any[]) => {
      if (typeof args[0] === 'string') {
        const [objtype, name, parentName, description, parentPath, responsible = '', transport = ''] = args;
        return libraryCreateObject(h, { objtype, name, parentName, description, parentPath, responsible, transport } as any);
      }
      return libraryCreateObject(h, { ...args[0] });
    }),
    lock: jest.fn(async () => ({ LOCK_HANDLE: 'H' })),
    unLock: jest.fn(async () => undefined),
    setObjectSource: jest.fn(async () => undefined),
    activate: jest.fn(async () => ({ success: true, messages: [] })),
    runClass: jest.fn(async () => 'ok'),
    deleteObject: jest.fn(async () => undefined),
  };
  const sentBody = () => String(request.mock.calls[0][1].body);
  return { client, request, sentBody };
}
const parse = (r: any) => JSON.parse(r.content[0].text);
const CLASS = { objtype: 'CLAS/OC', name: 'ZCL_DEMO', parentName: 'ZPKG', description: 'Demo', parentPath: '/sap/bc/adt/packages/zpkg' };

describe('createObject language', () => {
  it('creates the object in the logon language of the destination', async () => {
    const { client, sentBody } = make('pt');
    await new ObjectRegistrationHandlers(client).handle('createObject', { ...CLASS, transport: 'DEVK900123' });
    expect(sentBody()).toContain('adtcore:language="PT"');
    expect(sentBody()).toContain('adtcore:masterLanguage="PT"');
    expect(sentBody()).not.toContain('"EN"');
  });

  it('lets the caller name the language and the original language', async () => {
    const { client, sentBody } = make('pt');
    await new ObjectRegistrationHandlers(client).handle('createObject', { ...CLASS, language: 'de', masterLanguage: 'en' });
    expect(sentBody()).toContain('adtcore:language="DE"');
    expect(sentBody()).toContain('adtcore:masterLanguage="EN"');
  });

  it('keeps EN when neither the call nor the destination names a language', async () => {
    const { client, sentBody } = make(undefined);
    await new ObjectRegistrationHandlers(client).handle('createObject', CLASS);
    expect(sentBody()).toContain('adtcore:language="EN"');
    expect(sentBody()).toContain('adtcore:masterLanguage="EN"');
  });

  it('still sends name, package, description, responsible and transport', async () => {
    const { client, request, sentBody } = make('PT');
    await new ObjectRegistrationHandlers(client).handle('createObject', { ...CLASS, responsible: 'someone', transport: 'DEVK900123' });
    expect(request.mock.calls[0][0]).toBe('/sap/bc/adt/oo/classes');
    expect(request.mock.calls[0][1].qs).toEqual({ corrNr: 'DEVK900123' });
    expect(sentBody()).toContain('adtcore:name="ZCL_DEMO"');
    expect(sentBody()).toContain('adtcore:description="Demo"');
    expect(sentBody()).toContain('adtcore:responsible="SOMEONE"');
    expect(sentBody()).toContain('adtcore:name="ZPKG"');
  });

  it('refuses a language that is not a two-letter key before anything is sent', async () => {
    const { client, request } = make('PT');
    const handler = new ObjectRegistrationHandlers(client);
    for (const language of ['english', 'E', 'P"T', 'PT" adtcore:responsible="X']) {
      await expect(handler.handle('createObject', { ...CLASS, language })).rejects.toThrow(/language/);
      await expect(handler.handle('createObject', { ...CLASS, masterLanguage: language })).rejects.toThrow(/masterLanguage/);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('ignores a destination language that is not a two-letter key', async () => {
    const { client, sentBody } = make('pt-BR');
    await new ObjectRegistrationHandlers(client).handle('createObject', CLASS);
    expect(sentBody()).toContain('adtcore:language="EN"');
  });
});

describe('runSnippet language', () => {
  it('creates the temporary class in the logon language of the destination', async () => {
    const { client, sentBody } = make('PT');
    await new SnippetHandlers(client).handle('runSnippet', { code: "out->write( 'hi' ).", className: 'zcl_t' });
    expect(sentBody()).toContain('adtcore:language="PT"');
    expect(sentBody()).toContain('adtcore:name="ZCL_T"');
  });
});

function makeWithLedger() {
  const client: any = { stateful: session_types.stateful, seen: [] as string[] };
  client.createObject = jest.fn(async () => { client.seen.push(client.stateful); });
  return { client, handler: new ObjectRegistrationHandlers(client) };
}

describe('createObject and the stateful session', () => {
  it('creates outside the stateful context when no lock is held, so the object can be read at once', async () => {
    const { client, handler } = makeWithLedger();
    const res = parse(await handler.handle('createObject', CLASS));
    expect(client.seen).toEqual([session_types.stateless]);
    expect(client.stateful).toBe(session_types.stateful);
    expect(res).toMatchObject({ status: 'success', context: 'stateless' });
    expect(res.note).toBeUndefined();
  });

  it('keeps the stateful context when locks are held, and warns that the object is unreadable until written', async () => {
    const { client, handler } = makeWithLedger();
    recordLock(client, '/sap/bc/adt/oo/classes/zcl_other', 'H');
    try {
      const res = parse(await handler.handle('createObject', CLASS));
      expect(client.seen).toEqual([session_types.stateful]);
      expect(res).toMatchObject({ status: 'success', context: 'stateful', locksHeld: ['/sap/bc/adt/oo/classes/zcl_other'] });
      expect(res.note).toMatch(/setObjectSource/);
    } finally { clearLedger(client); }
  });
});

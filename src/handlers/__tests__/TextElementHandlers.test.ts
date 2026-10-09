import { TextElementHandlers } from '../TextElementHandlers';

const MAIN = "REPORT zdemo.\r\nWRITE: / TEXT-001.";

/**
 * bodies maps a path suffix (source/main, source/symbols, ...) to what the
 * system answers; a missing suffix answers 404.
 */
function makeHandler(bodies: Record<string, string>) {
  const client: any = {
    stateful: undefined,
    httpClient: {
      request: jest.fn(async (url: string) => {
        const key = Object.keys(bodies).find(k => url.endsWith(k));
        if (key === undefined) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { body: bodies[key], status: 200, statusText: 'OK', headers: {} };
      })
    },
    getTextElements: jest.fn(async () => ({ textElements: [{ id: '001', text: 'Hello' }], programName: 'zdemo' })),
    setTextElements: jest.fn(async () => undefined)
  };
  return { client, handler: new TextElementHandlers(client) };
}
const parse = (r: any) => JSON.parse(r.content[0].text);
const URL = '/sap/bc/adt/programs/programs/zdemo';
const SET_ARGS = { objectUrl: URL, category: 'symbols', elements: '[{"id":"001","text":"Hello"}]', lockHandle: 'H' };

describe('text elements on a release that serves them', () => {
  it('reads and writes through abap-adt-api', async () => {
    const { client, handler } = makeHandler({ 'source/main': MAIN, 'source/symbols': '@MaxLength:40\n001=Hello\n' });
    expect(parse(await handler.handle('getTextElements', { objectUrl: URL })).textElements).toHaveLength(1);
    expect(parse(await handler.handle('setTextElements', SET_ARGS)).updated).toBe(true);
    expect(client.setTextElements).toHaveBeenCalledTimes(1);
  });

  it('writes when the object has no text elements yet (404 on the category)', async () => {
    const { client, handler } = makeHandler({ 'source/main': MAIN });
    await handler.handle('setTextElements', SET_ARGS);
    expect(client.setTextElements).toHaveBeenCalledTimes(1);
  });
});

describe('text elements on SAP_BASIS 7.40', () => {
  // 7.40 answers .../source/symbols with the main source; a PUT there
  // replaced the program code with "001=Hello" in the live test on P03.
  const served740 = { 'source/main': MAIN, 'source/symbols': MAIN.replace(/\r\n/g, '\n'), 'source/selections': MAIN };

  it('refuses the write and never calls the PUT', async () => {
    const { client, handler } = makeHandler(served740);
    await expect(handler.handle('setTextElements', SET_ARGS)).rejects.toThrow(/not available on this system/);
    await expect(handler.handle('setTextElements', { ...SET_ARGS, category: 'selections', elements: '[{"id":"P_NAME","text":"Name"}]' }))
      .rejects.toThrow(/source\/selections answers the main source/);
    expect(client.setTextElements).not.toHaveBeenCalled();
  });

  it('refuses the read instead of returning ABAP code as text elements', async () => {
    const { client, handler } = makeHandler(served740);
    await expect(handler.handle('getTextElements', { objectUrl: `${URL}/source/main` })).rejects.toThrow(/Nothing was read or written/);
    expect(client.getTextElements).not.toHaveBeenCalled();
  });
});

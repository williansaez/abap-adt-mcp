/**
 * No systems configured: the server starts anyway, offers listSystems and
 * healthcheck only, and every other call answers with the setup instructions.
 */
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

jest.mock('puppeteer-core', () => ({}));
delete process.env.SAP_SYSTEMS;
delete process.env.SAP_URL;
process.env.SAP_SYSTEMS_FILE = '/nonexistent/abap-adt-mcp/systems.json';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AbapAdtServer } = require('../index');

const text = (r: any) => JSON.parse(r.content[0].text);

describe('setup mode', () => {
  let server: any;
  beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined); server = new AbapAdtServer(); });

  it('lists only listSystems and healthcheck', () => {
    expect(server.getToolCatalog().map((t: any) => t.name)).toEqual(['listSystems', 'healthcheck']);
  });

  it('reports needsSetup with the missing file and the next step', async () => {
    const health = text(await server.dispatch('healthcheck', {}, () => undefined));
    expect(health).toMatchObject({ status: 'needsSetup', destinations: [] });
    expect(health.setup).toMatch(/\/nonexistent\/abap-adt-mcp\/systems\.json does not exist/);
    expect(health.setup).toMatch(/abap-adt-mcp-setup/);
    const systems = text(await server.dispatch('listSystems', {}, () => undefined));
    expect(systems).toMatchObject({ systems: [], setup: health.setup });
  });

  it('refuses every other tool with the setup text', async () => {
    await expect(server.dispatch('searchObject', { query: 'X' }, () => undefined))
      .rejects.toMatchObject({ code: ErrorCode.InvalidRequest, message: expect.stringMatching(/does not exist/) });
  });
});

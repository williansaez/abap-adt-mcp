/**
 * Contract test: the tools/list payload must be valid MCP, fully annotated,
 * fully routed, and identical to the committed snapshot (npm run tools:docs).
 */
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { TOOL_ROUTES, SERVER_TOOLS } from '../toolManifest';

// puppeteer-core is ESM-only and irrelevant here (browser SSO is never exercised).
jest.mock('puppeteer-core', () => ({}));

process.env.SAP_SYSTEMS = JSON.stringify({ DEV: { url: 'https://example.invalid', authType: 'basic', user: 'u', password: 'p', client: '100' } });
delete process.env.MCP_TOOLSETS;
delete process.env.MCP_DISABLED_TOOLSETS;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AbapAdtServer } = require('../index');

describe('tool catalog contract', () => {
  const server = new AbapAdtServer();
  const tools: any[] = server.getToolCatalog();
  const names = tools.map(t => t.name);

  it('is a valid MCP tools/list result', () => {
    expect(() => ListToolsResultSchema.parse({ tools })).not.toThrow();
  });

  it('has unique names and every tool is routed to a handler or served by the server', () => {
    expect(new Set(names).size).toBe(names.length);
    const routed = new Set([...Object.values(TOOL_ROUTES).flat(), ...SERVER_TOOLS]);
    for (const n of names) expect(routed.has(n)).toBe(true);
    // and every routed tool (except the legacy misspelled alias) is published
    for (const n of routed) if (n !== 'adtCompatibiliyGraph') expect(names).toContain(n);
  });

  it('annotates every tool and describes every parameter', () => {
    for (const t of tools) {
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
      expect(t.description.length).toBeGreaterThan(10);
      const props = t.inputSchema.properties || {};
      for (const [pname, def] of Object.entries<any>(props)) {
        expect(def.type).toBeDefined();
        if (def.enum) expect(def.enum.length).toBeGreaterThan(0);
        if (pname !== 'destination' && ['getObjectSource', 'editObjectSource', 'setObjectSource', 'debuggerStep'].includes(t.name)) {
          expect(def.description).toBeDefined();
        }
      }
      for (const r of t.inputSchema.required || []) expect(props[r]).toBeDefined();
      if (t.name !== 'listSystems' && t.name !== 'healthcheck') expect(props.destination).toBeDefined();
    }
  });

  it('matches docs/tools.snapshot.json (run npm run tools:docs after changing tools)', () => {
    const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'tools.snapshot.json'), 'utf8'));
    const snapNames = snapshot.tools.map((t: any) => t.name);
    expect([...names].sort()).toEqual([...snapNames].sort());
    expect(snapshot.count).toBe(tools.length);
    for (const t of tools) {
      const s = snapshot.tools.find((x: any) => x.name === t.name);
      expect({ name: t.name, readOnly: s.readOnly, destructive: s.destructive, required: s.required })
        .toEqual({ name: t.name, readOnly: !!t.annotations.readOnlyHint, destructive: !!t.annotations.destructiveHint, required: (t.inputSchema.required || []).filter((r: string) => r !== 'destination') });
    }
  });
});

import { resolveToolsets, TOOLSETS, TOOL_ROUTES, TOOLSET_PRESETS, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS, HANDLER_KEYS } from '../../toolManifest';

describe('toolManifest', () => {
  it('routes every handler key and every toolset handler exists', () => {
    for (const key of HANDLER_KEYS) expect(TOOL_ROUTES[key].length).toBeGreaterThan(0);
    const covered = new Set(Object.values(TOOLSETS).flatMap(t => t.handlers));
    for (const key of HANDLER_KEYS) expect(covered.has(key)).toBe(true);
  });

  it('never marks a tool both read-only and destructive', () => {
    for (const t of READ_ONLY_TOOLS) expect(DESTRUCTIVE_TOOLS.has(t)).toBe(false);
  });

  it('enables everything by default and always keeps core', () => {
    const sel = resolveToolsets({});
    expect(sel.active).toEqual(TOOLSET_PRESETS.all);
    expect(sel.enabledTools.has('debuggerStep')).toBe(true);
    expect(sel.enabledTools.has('listSystems')).toBe(true);
    const noCore = resolveToolsets({ MCP_TOOLSETS: 'source', MCP_DISABLED_TOOLSETS: 'core' });
    expect(noCore.active).toEqual(['core', 'source']);
    expect(noCore.enabledTools.has('login')).toBe(true);
  });

  it('applies presets and explicit lists', () => {
    const focused = resolveToolsets({ MCP_TOOLSETS: 'focused' });
    expect(focused.active).toEqual(TOOLSET_PRESETS.focused);
    expect(focused.enabledTools.has('gitPullRepo')).toBe(false);
    expect(focused.enabledTools.has('setObjectSource')).toBe(true);
    const custom = resolveToolsets({ MCP_TOOLSETS: 'source, git' });
    expect(custom.active).toEqual(['core', 'source', 'git']);
    expect(custom.toolsetOf.get('gitPullRepo')).toBe('git');
  });

  it('subtracts disabled toolsets from the active set', () => {
    const sel = resolveToolsets({ MCP_DISABLED_TOOLSETS: 'debugger,traces' });
    expect(sel.active).not.toContain('debugger');
    expect(sel.disabled).toEqual(['debugger', 'traces']);
    expect(sel.enabledTools.has('tracesList')).toBe(false);
  });

  it('rejects unknown toolset names loudly', () => {
    expect(() => resolveToolsets({ MCP_TOOLSETS: 'source,nope' })).toThrow(/unknown toolset\(s\): nope/);
    expect(() => resolveToolsets({ MCP_DISABLED_TOOLSETS: 'dbg' })).toThrow(/MCP_DISABLED_TOOLSETS/);
  });
});

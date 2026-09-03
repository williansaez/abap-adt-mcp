import http from 'http';
import { originAllowed, hostAllowed, readHttpOptions, bearerOk } from '../lib/httpTransport';

process.env.SAP_SYSTEMS = JSON.stringify({ DEV: { url: 'https://example.invalid', authType: 'basic', user: 'u', password: 'p', client: '100' } });
delete process.env.MCP_TOOLSETS;
delete process.env.MCP_DISABLED_TOOLSETS;
jest.mock('puppeteer-core', () => ({}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AbapAdtServer } = require('../index');

const TOKEN = 't0ken';
const env = (extra: Record<string, string> = {}) => ({ ...process.env, MCP_HTTP_PORT: '0', MCP_HTTP_TOKEN: TOKEN, ...extra });

async function mcpPost(base: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean).pop();
    json = data ? JSON.parse(data) : undefined;
  } else if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return { res, json, sessionId: res.headers.get('mcp-session-id') };
}
const init = (id = 1) => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });

describe('http options and guards', () => {
  it('compares bearer tokens on UTF-8 bytes without throwing on multibyte input', () => {
    expect(bearerOk('Bearer t0ken', 't0ken')).toBe(true);
    expect(bearerOk('Bearer tôken', 't0ken')).toBe(false); // same character count, different byte length
    expect(bearerOk('Bearer t0kén', 't0kén')).toBe(true);
    expect(bearerOk('Bearer ', 't0ken')).toBe(false);
    expect(bearerOk(undefined, 't0ken')).toBe(false);
    expect(bearerOk('Basic dXNlcg==', 'user')).toBe(false);
  });

  it('validates the port and reads limits', () => {
    expect(() => readHttpOptions({ MCP_HTTP_PORT: '80' } as any, '1')).toThrow(/between 1024/);
    expect(readHttpOptions({ MCP_HTTP_PORT: '0' } as any, '1').port).toBe(0);
    const o = readHttpOptions({ MCP_HTTP_PORT: '2236', MCP_HTTP_MAX_SESSIONS: '3', MCP_HTTP_SESSION_TTL_MINUTES: '5', MCP_HTTP_ALLOWED_ORIGINS: 'https://a, https://b' } as any, '1');
    expect(o).toMatchObject({ port: 2236, host: '127.0.0.1', maxSessions: 3, sessionTtlMs: 300000, allowedOrigins: ['https://a', 'https://b'] });
  });

  it('accepts loopback origins/hosts on a loopback bind and rejects others unless allowed', () => {
    const loop: any = { host: '127.0.0.1', allowedOrigins: [], allowedHosts: [] };
    expect(originAllowed(undefined, loop)).toBe(true);
    expect(originAllowed('http://localhost:3000', loop)).toBe(true);
    expect(originAllowed('https://evil.example', loop)).toBe(false);
    expect(originAllowed('https://evil.example', { ...loop, allowedOrigins: ['*'] })).toBe(true);
    expect(hostAllowed('localhost:2236', loop)).toBe(true);
    expect(hostAllowed('attacker.example:2236', loop)).toBe(false);
    expect(hostAllowed('attacker.example:2236', { ...loop, allowedHosts: ['attacker.example'] })).toBe(true);
    expect(hostAllowed('any.example', { host: '0.0.0.0', allowedHosts: [] })).toBe(true);
  });
});

describe('http transport end to end', () => {
  let handle: any; let base: string;
  beforeAll(async () => {
    const server = new AbapAdtServer();
    handle = await server.startHttp(env({ MCP_HTTP_MAX_SESSIONS: '2', MCP_HTTP_SESSION_TTL_MINUTES: '1' }));
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(async () => { await handle.close(); });

  it('serves /health without a token and refuses /mcp without one', async () => {
    const h = await (await fetch(`${base}/health`)).json();
    expect(h).toMatchObject({ status: 'ok', sessions: 0, maxSessions: 2 });
    const r = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });

  it('rejects foreign Origin and Host headers', async () => {
    const o = await mcpPost(base, init(), { Origin: 'https://evil.example' });
    expect(o.res.status).toBe(403);
    // fetch refuses to override Host, so use the raw client for the rebinding case
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: handle.port, path: '/mcp', method: 'POST', headers: { Host: 'attacker.example', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` } }, res => { res.resume(); resolve(res.statusCode || 0); });
      req.on('error', reject);
      req.end(JSON.stringify(init()));
    });
    expect(status).toBe(403);
    expect(handle.sessions()).toBe(0);
  });

  it('opens one session per initialize, serves tools/list per session and ends on DELETE', async () => {
    const a = await mcpPost(base, init());
    expect(a.res.status).toBe(200);
    expect(a.sessionId).toBeTruthy();
    expect(a.json.result.serverInfo.name).toBe('abap-adt-mcp');
    const b = await mcpPost(base, init());
    expect(b.sessionId).toBeTruthy();
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(handle.sessions()).toBe(2);
    await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': a.sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const list = await mcpPost(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': a.sessionId! });
    expect(list.res.status).toBe(200);
    expect(list.json.result.tools.length).toBeGreaterThan(150);
    // third session exceeds the cap
    const c = await mcpPost(base, init());
    expect(c.res.status).toBe(503);
    expect(c.res.headers.get('retry-after')).toBe('30');
    // non-initialize without a session id, unknown session id
    const bad = await mcpPost(base, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(bad.res.status).toBe(400);
    const unknown = await mcpPost(base, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-session-id': 'nope' });
    expect(unknown.res.status).toBe(404);
    const del = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': a.sessionId! } });
    expect([200, 204]).toContain(del.status);
    await new Promise(r => setTimeout(r, 50));
    expect(handle.sessions()).toBe(1);
    // idle sweep closes the remaining session
    expect(await handle.sweep(Date.now() + 2 * 60_000)).toBe(1);
    expect(handle.sessions()).toBe(0);
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(0);
  });
});

describe('request body limits', () => {
  it('applies the size limit to session requests, not only to the one that opens the session', async () => {
    const server = new AbapAdtServer();
    const handle = await server.startHttp(env({ MCP_HTTP_MAX_BODY_BYTES: '2048' }));
    try {
      const base = `http://127.0.0.1:${handle.port}`;
      // Open a session.
      const opened = await mcpPost(base, init());
      expect(opened.sessionId).toBeTruthy();
      // A request on that session carrying an oversized body is refused with 413,
      // instead of being streamed into the SDK transport unbounded.
      const big = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'healthcheck', arguments: { pad: 'x'.repeat(8192) } } };
      const r = await mcpPost(base, big, { 'mcp-session-id': opened.sessionId! });
      expect(r.res.status).toBe(413);
      // The session survives: a normal request still works.
      const ok = await mcpPost(base, { jsonrpc: '2.0', id: 10, method: 'tools/list' }, { 'mcp-session-id': opened.sessionId! });
      expect(ok.res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

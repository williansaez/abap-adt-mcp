/**
 * Streamable HTTP front door: one MCP server instance per session, bearer
 * token, Origin/Host validation (DNS-rebinding protection), session limits
 * and idle expiry, and an unauthenticated /health endpoint.
 */
import http from 'http';
import crypto from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface HttpOptions {
  port: number;
  host: string;
  token: string;
  maxSessions: number;
  sessionTtlMs: number;
  /** Allowed Origin header values ('*' allows any); loopback origins are always allowed when bound to loopback. */
  allowedOrigins: string[];
  /** Allowed Host header values (host[:port]); loopback hosts are always allowed when bound to loopback. */
  allowedHosts: string[];
  version: string;
  maxBodyBytes?: number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const isLoopbackBind = (host: string) => LOOPBACK_HOSTS.has(host);
const stripPort = (hostHeader: string) => hostHeader.replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
const list = (v: string | undefined) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export function readHttpOptions(env: NodeJS.ProcessEnv, version: string): HttpOptions {
  const port = parseInt(env.MCP_HTTP_PORT || '', 10);
  // 0 = ephemeral port (tests); otherwise an unprivileged fixed port.
  if (!(port === 0 && env.MCP_HTTP_PORT === '0') && (!port || port < 1024 || port > 65535)) {
    throw new Error(`MCP_HTTP_PORT must be between 1024 and 65535, got ${env.MCP_HTTP_PORT}`);
  }
  const ttlMin = Number(env.MCP_HTTP_SESSION_TTL_MINUTES || 30);
  const max = Number(env.MCP_HTTP_MAX_SESSIONS || 16);
  return {
    port,
    host: env.MCP_HTTP_HOST || '127.0.0.1',
    token: env.MCP_HTTP_TOKEN || '',
    maxSessions: Number.isFinite(max) && max > 0 ? Math.floor(max) : 16,
    sessionTtlMs: (Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 30) * 60_000,
    allowedOrigins: list(env.MCP_HTTP_ALLOWED_ORIGINS),
    allowedHosts: list(env.MCP_HTTP_ALLOWED_HOSTS),
    version,
  };
}

/** Origin allowed? Absent Origin (non-browser clients) is accepted. */
export function originAllowed(origin: string | undefined, opts: Pick<HttpOptions, 'host' | 'allowedOrigins'>): boolean {
  if (!origin) return true;
  if (opts.allowedOrigins.includes('*') || opts.allowedOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (isLoopbackBind(opts.host) && LOOPBACK_HOSTS.has(u.hostname)) return true;
  } catch { /* malformed origin */ }
  return false;
}

/** Host header allowed? Guards against DNS rebinding when bound to loopback. */
export function hostAllowed(hostHeader: string | undefined, opts: Pick<HttpOptions, 'host' | 'allowedHosts'>): boolean {
  if (!hostHeader) return !isLoopbackBind(opts.host);
  if (opts.allowedHosts.includes('*') || opts.allowedHosts.includes(hostHeader) || opts.allowedHosts.includes(stripPort(hostHeader))) return true;
  if (isLoopbackBind(opts.host)) return LOOPBACK_HOSTS.has(stripPort(hostHeader));
  return true;
}

interface Session { transport: StreamableHTTPServerTransport; server: Server; lastActivity: number; createdAt: number }

export interface HttpHandle {
  port: number;
  host: string;
  sessions(): number;
  sweep(now?: number): Promise<number>;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
};

export async function startHttpServer(createServer: () => Server, opts: HttpOptions): Promise<HttpHandle> {
  const sessions = new Map<string, Session>();
  const startedAt = Date.now();
  const expected = opts.token;

  const tokenOk = (req: http.IncomingMessage) => {
    const auth = req.headers.authorization || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return provided.length === expected.length && provided.length > 0 && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  };

  const closeSession = async (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    try { await s.transport.close(); } catch { /* already closed */ }
    try { await s.server.close(); } catch { /* already closed */ }
  };

  const sweep = async (now = Date.now()) => {
    let closed = 0;
    for (const [id, s] of sessions) {
      if (now - s.lastActivity > opts.sessionTtlMs) { await closeSession(id); closed++; }
    }
    return closed;
  };
  const sweeper = setInterval(() => { void sweep(); }, Math.min(opts.sessionTtlMs, 60_000));
  sweeper.unref();

  const httpServer = http.createServer(async (req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && url === '/health') {
      json(res, 200, { status: 'ok', version: opts.version, sessions: sessions.size, maxSessions: opts.maxSessions, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
      return;
    }
    if (!url.startsWith('/mcp')) { res.writeHead(404).end(); return; }
    if (!hostAllowed(req.headers.host, opts)) { json(res, 403, { error: 'Forbidden: Host header not allowed (DNS rebinding protection). Set MCP_HTTP_ALLOWED_HOSTS to permit it.' }); return; }
    if (!originAllowed(req.headers.origin as string | undefined, opts)) { json(res, 403, { error: 'Forbidden: Origin not allowed. Set MCP_HTTP_ALLOWED_ORIGINS to permit it.' }); return; }
    if (!tokenOk(req)) { json(res, 401, { error: 'Unauthorized: send Authorization: Bearer <token>' }); return; }

    const sessionId = req.headers['mcp-session-id'];
    const idHeader = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    try {
      if (idHeader) {
        const s = sessions.get(idHeader);
        if (!s) { json(res, 404, { error: 'Unknown or expired session; send a new initialize request without mcp-session-id.' }); return; }
        s.lastActivity = Date.now();
        await s.transport.handleRequest(req, res);
        return;
      }
      if (req.method !== 'POST') { json(res, 400, { error: 'Missing mcp-session-id header' }); return; }
      let body: any;
      try {
        body = JSON.parse(await readBody(req, opts.maxBodyBytes ?? 4 * 1024 * 1024));
      } catch (e: any) {
        json(res, 400, { error: `Invalid JSON body: ${e.message}` }); return;
      }
      const isInit = Array.isArray(body) ? body.some(m => m?.method === 'initialize') : body?.method === 'initialize';
      if (!isInit) { json(res, 400, { error: 'Missing mcp-session-id header; only initialize may open a session.' }); return; }
      if (sessions.size >= opts.maxSessions) {
        json(res, 503, { error: `Too many sessions (${sessions.size}/${opts.maxSessions}); retry later or raise MCP_HTTP_MAX_SESSIONS.` }, { 'Retry-After': '30' });
        return;
      }
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => { sessions.set(id, { transport, server, lastActivity: Date.now(), createdAt: Date.now() }); },
        onsessionclosed: (id) => { void closeSession(id); },
      });
      transport.onclose = () => { if (transport.sessionId) void closeSession(transport.sessionId); };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error('[abap-adt-mcp] HTTP request error:', error);
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port, host: opts.host,
    sessions: () => sessions.size,
    sweep,
    close: async () => {
      clearInterval(sweeper);
      for (const id of [...sessions.keys()]) await closeSession(id);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

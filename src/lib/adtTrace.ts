/**
 * Opt-in HTTP trace of the ADT traffic of every destination, for diagnosing
 * a backend that behaves differently from the others (an old release, a
 * reverse proxy, a session that does not stick). Set MCP_ADT_TRACE_FILE to a
 * path and one JSON line per request is appended there.
 *
 * Secrets never reach the file: cookie, set-cookie, authorization and CSRF
 * token values are replaced by their name and length, no response body is
 * kept, and an error (status 400 and above) keeps only the first 300
 * characters of its redacted text. The trace is still about the user's SAP
 * traffic, so the file is created private (0600).
 */

import fs from 'fs';
import { redactSecrets } from './redact.js';

const SECRET_HEADER = /^(cookie|set-cookie|authorization|x-csrf-token|sap-contextid)$/i;

function redactCookieList(value: string): string {
  // "a=1; b=2" -> "a(1) b(1)": names and value lengths only.
  return value.split(';').map(part => {
    const eq = part.indexOf('=');
    if (eq <= 0) return part.trim();
    return `${part.slice(0, eq).trim()}(${part.slice(eq + 1).trim().length})`;
  }).filter(Boolean).join(' ');
}

function redactSetCookie(raw: string): string {
  // "name=value; path=/x; HttpOnly" -> "name(len); path=/x; HttpOnly"
  const [first, ...attrs] = raw.split(';');
  const eq = first.indexOf('=');
  const head = eq > 0 ? `${first.slice(0, eq).trim()}(${first.slice(eq + 1).trim().length})` : first.trim();
  return [head, ...attrs.map(a => a.trim())].join('; ');
}

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SECRET_HEADER.test(k)) { out[k] = v; continue; }
    const key = k.toLowerCase();
    if (key === 'set-cookie') out[k] = (Array.isArray(v) ? v : [String(v)]).map(s => redactSetCookie(String(s)));
    else if (key === 'cookie') out[k] = redactCookieList(String(v ?? ''));
    else out[k] = `<redacted ${String(v ?? '').length} chars>`;
  }
  return out;
}

/** Build the debugCallback abap-adt-api accepts, or undefined when tracing is off. */
export function adtTraceCallback(destination: string, env: NodeJS.ProcessEnv = process.env): ((data: any) => void) | undefined {
  const file = env.MCP_ADT_TRACE_FILE;
  if (!file) return undefined;
  return (data: any) => {
    try {
      const req = data?.request || {};
      const res = data?.response || {};
      const line = {
        ts: new Date().toISOString(),
        destination,
        id: data?.id,
        stateful: data?.stateful,
        method: req.method,
        uri: req.uri,
        params: req.params,
        requestHeaders: redactHeaders(req.headers),
        status: res.statusCode,
        responseHeaders: redactHeaders(res.headers),
        // Only for errors, and only their text: a successful body can carry a
        // reentrance ticket, a lock handle or table data. abap-adt-api reports an
        // error as its message (statusMessage), rarely with a body; 501 marks a
        // failure that got no SAP answer at all (a transport or RFC error).
        error: Number(res.statusCode) >= 400
          ? redactSecrets(String(typeof res.body === 'string' && res.body ? res.body : res.statusMessage ?? '')).slice(0, 300) || undefined
          : undefined,
        durationMs: data?.duration,
      };
      fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
    } catch { /* tracing never breaks a request */ }
  };
}

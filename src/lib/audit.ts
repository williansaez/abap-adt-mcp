/**
 * Optional JSONL audit trail of every tool call: who asked what on which
 * destination, how long it took, and whether it was refused by policy.
 * Enabled with MCP_AUDIT_FILE=<path>. Arguments are summarized (secrets
 * redacted, long values truncated) so the file stays small and safe.
 */
import fs from 'fs';
import path from 'path';

export interface AuditRecord {
  ts: string;
  requestId: number;
  tool: string;
  destination?: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'denied' | 'unavailable';
  errorKind?: string;
  gate?: string;
  message?: string;
  args?: Record<string, unknown>;
  retried?: boolean;
}

const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|lockhandle/i;
const MAX_VALUE = 200;

/** Compact, redacted view of the call arguments. */
function redactValue(v: unknown, redact: (s: string) => string, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return redact(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth > 3) return '[nested]';
  if (Array.isArray(v)) return v.slice(0, 20).map(x => redactValue(x, redact, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redactValue(x, redact, depth + 1);
    return out;
  }
  return String(v);
}

export function summarizeArgs(args: any, redact: (s: string) => string): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  try {
    for (const [k, v] of Object.entries(args)) {
      if (SECRET_KEYS.test(k)) { out[k] = '[REDACTED]'; continue; }
      if (v === undefined) continue;
      if (typeof v === 'string') {
        out[k] = v.length > MAX_VALUE ? redact(v.slice(0, MAX_VALUE)) + `…[${v.length} chars]` : redact(v);
      } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
        out[k] = v;
      } else {
        const s = JSON.stringify(v);
        out[k] = s.length > MAX_VALUE ? `[${Array.isArray(v) ? 'array' : 'object'} ${s.length} chars]` : redactValue(v, redact);
      }
    }
  } catch {
    out._summary = '[unserializable arguments]';
  }
  return out;
}

export class AuditLog {
  private warned = false;
  private seq = 0;
  constructor(private file: string | undefined, private redact: (s: string) => string) {}

  get enabled(): boolean { return !!this.file; }
  nextId(): number { return ++this.seq; }

  /** Append one record; never throws, warns once on failure. */
  write(rec: Omit<AuditRecord, 'ts'>): void {
    if (!this.file) return;
    let line: string;
    try {
      line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n';
    } catch {
      line = JSON.stringify({ ts: new Date().toISOString(), requestId: rec.requestId, tool: rec.tool, outcome: rec.outcome, note: 'record not serializable' }) + '\n';
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, line, { mode: 0o600 });
    } catch (e: any) {
      if (!this.warned) {
        this.warned = true;
        console.error(`[abap-adt-mcp] audit log ${this.file} not writable: ${e?.message || e}`);
      }
    }
  }
}

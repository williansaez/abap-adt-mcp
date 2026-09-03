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
export function summarizeArgs(args: any, redact: (s: string) => string): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_KEYS.test(k)) { out[k] = '[REDACTED]'; continue; }
    if (v === undefined) continue;
    if (typeof v === 'string') {
      out[k] = v.length > MAX_VALUE ? redact(v.slice(0, MAX_VALUE)) + `…[${v.length} chars]` : redact(v);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else {
      const s = JSON.stringify(v);
      out[k] = s.length > MAX_VALUE ? `[${Array.isArray(v) ? 'array' : 'object'} ${s.length} chars]` : JSON.parse(redact(s));
    }
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
    const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n';
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

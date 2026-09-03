import fs from 'fs';
import os from 'os';
import path from 'path';
import { AuditLog, summarizeArgs } from '../audit';

const redact = (s: string) => s.replace(/hunter2/g, '[REDACTED]');

describe('audit log', () => {
  it('summarizes arguments: secrets redacted, long values truncated, objects sized', () => {
    const s = summarizeArgs({ destination: 'DEV', lockHandle: 'abc', password: 'x', source: 'a'.repeat(500), n: 3, flag: true, obj: { a: 1 }, big: { s: 'z'.repeat(300) }, note: 'pw hunter2' }, redact)!;
    expect(s.lockHandle).toBe('[REDACTED]');
    expect(s.password).toBe('[REDACTED]');
    expect(String(s.source)).toMatch(/…\[500 chars\]$/);
    expect(s.n).toBe(3);
    expect(s.obj).toEqual({ a: 1 });
    expect(s.big).toMatch(/^\[object \d+ chars\]$/);
    expect(s.note).toBe('pw [REDACTED]');
    expect(summarizeArgs(undefined, redact)).toBeUndefined();
  });

  it('appends JSONL records with sequential ids and stays silent when disabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    const file = path.join(dir, 'sub', 'audit.jsonl');
    const log = new AuditLog(file, redact);
    expect(log.enabled).toBe(true);
    const id1 = log.nextId(); const id2 = log.nextId();
    log.write({ requestId: id1, tool: 'getObjectSource', destination: 'DEV', durationMs: 12, outcome: 'ok' });
    log.write({ requestId: id2, tool: 'deleteObject', destination: 'PRD', durationMs: 1, outcome: 'denied', gate: 'readOnly', errorKind: 'policyDenied' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ requestId: 1, tool: 'getObjectSource', outcome: 'ok' });
    expect(lines[1]).toMatchObject({ requestId: 2, outcome: 'denied', gate: 'readOnly' });
    expect(typeof lines[0].ts).toBe('string');
    const off = new AuditLog(undefined, redact);
    expect(off.enabled).toBe(false);
    expect(() => off.write({ requestId: 1, tool: 'x', durationMs: 0, outcome: 'ok' })).not.toThrow();
  });

  it('redacts nested values and never throws on odd arguments', () => {
    const redact = (v: string) => v.replace(/secret/gi, '[X]');
    const out = summarizeArgs({ nested: { password: 'p', note: 'my secret' }, list: ['secret', 1], fn: () => 1 }, redact) as any;
    expect(out.nested).toEqual({ password: '[REDACTED]', note: 'my [X]' });
    expect(out.list).toEqual(['[X]', 1]);
    const cyclic: any = { a: 1 }; cyclic.self = cyclic;
    expect(() => summarizeArgs(cyclic, redact)).not.toThrow();
    expect((summarizeArgs(cyclic, redact) as any)._summary).toBe('[unserializable arguments]');
  });
});

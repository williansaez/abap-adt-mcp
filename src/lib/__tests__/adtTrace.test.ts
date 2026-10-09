import fs from 'fs';
import os from 'os';
import path from 'path';
import { adtTraceCallback, redactHeaders } from '../adtTrace';

describe('adtTrace', () => {
  it('keeps header names and lengths but never secret values', () => {
    const out = redactHeaders({
      Cookie: 'SAP_SESSIONID_P03_900=abcdef; sap-contextid=SID%3aANON%3a123',
      'set-cookie': ['sap-contextid=SID%3aANON%3a123; path=/sap/bc/adt; HttpOnly', 'sap-usercontext=sap-client=900; path=/'],
      authorization: 'Basic dXNlcjpwdw==',
      'x-csrf-token': 'TOKEN123',
      'content-type': 'text/plain',
    });
    expect(JSON.stringify(out)).not.toMatch(/abcdef|ANON|dXNlcjpwdw|TOKEN123/);
    expect(out.Cookie).toBe('SAP_SESSIONID_P03_900(6) sap-contextid(16)');
    expect(out['set-cookie']).toEqual(['sap-contextid(16); path=/sap/bc/adt; HttpOnly', 'sap-usercontext(14); path=/']);
    expect(out['content-type']).toBe('text/plain');
  });

  it('is off without MCP_ADT_TRACE_FILE and appends one redacted line per request with it', () => {
    expect(adtTraceCallback('DEV', {})).toBeUndefined();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adt-trace-')), 'trace.jsonl');
    const cb = adtTraceCallback('DEV', { MCP_ADT_TRACE_FILE: file })!;
    cb({
      id: 7, stateful: true, duration: 12,
      request: { method: 'POST', uri: '/sap/bc/adt/programs/programs/zx', params: { _action: 'LOCK' }, headers: { Cookie: 'a=secret' } },
      response: { statusCode: 200, headers: { 'set-cookie': ['sap-contextid=XYZ; path=/'] }, body: '<x>' + 'y'.repeat(1000) },
    });
    cb({
      id: 8, stateful: true, duration: 3,
      request: { method: 'PUT', uri: '/sap/bc/adt/programs/programs/zx/source/main', params: {}, headers: {} },
      response: { statusCode: 423, headers: {}, body: '<exc:exception>' + 'z'.repeat(1000) },
    });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ destination: 'DEV', id: 7, stateful: true, method: 'POST', uri: '/sap/bc/adt/programs/programs/zx', status: 200 });
    expect(rec.requestHeaders.Cookie).toBe('a(6)');
    expect(rec.responseHeaders['set-cookie']).toEqual(['sap-contextid(3); path=/']);
    // a successful answer keeps no text; an error keeps the first 300 characters of its text
    expect(rec.error).toBeUndefined();
    expect(rec.bodyHead).toBeUndefined();
    expect(JSON.parse(lines[1]).error.length).toBe(300);
    // abap-adt-api reports most errors as a message without a body; secrets in it are redacted
    cb({ id: 9, request: { method: 'GET', uri: '/sap/bc/adt/x', headers: {} }, response: { statusCode: 404, headers: {}, statusMessage: 'Resource ZX does not exist (Authorization: Bearer abc.def.ghi)' } });
    const last = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n')[2]);
    expect(last.error).toMatch(/^Resource ZX does not exist/);
    expect(last.error).not.toMatch(/abc\.def\.ghi/);
    expect(lines[0]).not.toMatch(/secret|XYZ/);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseTlsConfig, loadPemMaterial, buildHttpsAgent, describeTls, enforceTlsVerification } from '../tls';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('tls', () => {
  it('parses and validates the tls block', () => {
    expect(parseTlsConfig(undefined)).toBeUndefined();
    expect(parseTlsConfig({})).toBeUndefined();
    expect(parseTlsConfig({ ca: '/etc/ca.pem' })).toEqual({ ca: '/etc/ca.pem', cert: undefined, key: undefined, pfx: undefined, passphrase: undefined });
    expect(() => parseTlsConfig({ cert: '/c.pem' })).toThrow(/requires tls.key/);
    expect(() => parseTlsConfig({ key: '/k.pem' })).toThrow(/requires tls.cert/);
  });

  it('accepts inline PEM or file paths and reports unreadable files by name', () => {
    expect(loadPemMaterial(PEM, 'ca')).toBe(PEM);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
    const file = path.join(dir, 'ca.pem');
    fs.writeFileSync(file, PEM);
    expect(loadPemMaterial(file, 'ca')!.toString()).toBe(PEM);
    expect(() => loadPemMaterial(path.join(dir, 'missing.pem'), 'cert')).toThrow(/tls.cert: cannot read/);
  });

  it('always builds an agent that carries the verification decision', () => {
    // A destination that configured nothing is the common case and the one that
    // matters: its agent has to say "verify", so no ambient setting can decide
    // for it.
    for (const plain of [buildHttpsAgent(undefined, undefined), buildHttpsAgent(undefined, false)] as any[]) {
      expect(plain.options.rejectUnauthorized).toBe(true);
      expect(plain.options.keepAlive).toBe(true);
    }
    const insecure: any = buildHttpsAgent(undefined, true);
    expect(insecure.options.rejectUnauthorized).toBe(false);
    const mtls: any = buildHttpsAgent({ ca: PEM, cert: PEM, key: PEM, passphrase: 'pw' }, false);
    expect(mtls.options.ca).toBe(PEM);
    expect(mtls.options.cert).toBe(PEM);
    expect(mtls.options.passphrase).toBe('pw');
    expect(mtls.options.rejectUnauthorized).toBe(true);
    expect(describeTls({ ca: PEM, cert: PEM, key: PEM }, true)).toBe('custom CA, client certificate, verification disabled');
    expect(describeTls(undefined, false)).toBeUndefined();
  });

  it('removes NODE_TLS_REJECT_UNAUTHORIZED=0 so one destination cannot disable verification for all', () => {
    const env: any = { NODE_TLS_REJECT_UNAUTHORIZED: '0', OTHER: 'kept' };
    expect(enforceTlsVerification(env)).toBe(true);
    expect('NODE_TLS_REJECT_UNAUTHORIZED' in env).toBe(false);
    expect(env.OTHER).toBe('kept');
  });

  it('leaves the variable alone unless it is the exact value Node acts on', () => {
    // Node bypasses verification only for the literal "0"; every other value
    // already means "verify", so removing it would be a change with no effect.
    for (const value of ['1', ' 0', 'false', 'no', '']) {
      const env: any = { NODE_TLS_REJECT_UNAUTHORIZED: value };
      expect(enforceTlsVerification(env)).toBe(false);
      expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(value);
    }
    const empty: any = {};
    expect(enforceTlsVerification(empty)).toBe(false);
  });
});

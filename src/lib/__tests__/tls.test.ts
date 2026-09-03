import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseTlsConfig, loadPemMaterial, buildHttpsAgent, describeTls } from '../tls';

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

  it('builds an https agent only when something is configured', () => {
    expect(buildHttpsAgent(undefined, false)).toBeUndefined();
    const insecure: any = buildHttpsAgent(undefined, true);
    expect(insecure.options.rejectUnauthorized).toBe(false);
    const mtls: any = buildHttpsAgent({ ca: PEM, cert: PEM, key: PEM, passphrase: 'pw' }, false);
    expect(mtls.options.ca).toBe(PEM);
    expect(mtls.options.cert).toBe(PEM);
    expect(mtls.options.passphrase).toBe('pw');
    expect(mtls.options.rejectUnauthorized).toBeUndefined();
    expect(describeTls({ ca: PEM, cert: PEM, key: PEM }, true)).toBe('custom CA, client certificate, verification disabled');
    expect(describeTls(undefined, false)).toBeUndefined();
  });
});

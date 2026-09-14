import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSystems, resolveEnvRefs, validateSystem, hasInlineSecrets, checkConfigFileMode } from '../systems';

const base = { url: 'https://sap.example.com:44300', authType: 'basic', user: 'DEV', password: 'x', client: '100' };

describe('systems configuration', () => {
  it('resolves ${env:VAR} and ${VAR} references, failing on missing ones without leaking values', () => {
    const env = { SAP_PW: 's3cret', SAP_HOST: 'sap.example.com' } as any;
    expect(resolveEnvRefs({ url: 'https://${env:SAP_HOST}:44300', password: '${SAP_PW}', nested: { a: ['${env:SAP_PW}'] } }, env))
      .toEqual({ url: 'https://sap.example.com:44300', password: 's3cret', nested: { a: ['s3cret'] } });
    expect(() => resolveEnvRefs({ password: '${env:MISSING}' }, env, 'systems.DEV')).toThrow(/systems\.DEV\.password: environment variable MISSING/);
    const systems = readSystems({ SAP_SYSTEMS: JSON.stringify({ DEV: { ...base, password: '${env:SAP_PW}' } }), SAP_PW: 'pw' } as any);
    expect(systems.get('DEV')!.password).toBe('pw');
  });

  it('validates eagerly: url, client, basic credentials', () => {
    expect(() => validateSystem({ name: 'X', url: 'not a url', authType: 'sso' } as any)).toThrow(/valid http\(s\) URL/);
    expect(() => validateSystem({ name: 'X', url: 'https://h', client: '1', authType: 'sso' } as any)).toThrow(/3-digit/);
    expect(() => validateSystem({ name: 'X', url: 'https://h', authType: 'basic' } as any)).toThrow(/requires user and password/);
    expect(() => readSystems({ SAP_SYSTEMS: '{}' } as any)).toThrow(/empty/);
    expect(() => readSystems({ SAP_SYSTEMS: JSON.stringify({ DEV: { ...base, url: 'ftp://x' } }) } as any)).toThrow(/DEV/);
  });

  it('legacy SAP_URL setup infers the auth mode from the credentials present', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const url = 'https://sap.example.com:44300';
    // No systems.json may shadow the legacy branch (the checkout keeps a git-ignored one).
    const legacy = (extra: Record<string, string>) => readSystems({ SAP_URL: url, SAP_SYSTEMS_FILE: '/nonexistent/systems.json', ...extra } as any).get('default')!;
    // SAP_USER + SAP_PASSWORD, no SAP_AUTH_TYPE: basic, as the templates intend.
    let cfg = legacy({SAP_USER: 'DEV', SAP_PASSWORD: 'pw' });
    expect(cfg.authType).toBe('basic');
    expect(cfg.user).toBe('DEV');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using basic'));
    // The three OAuth variables, no SAP_AUTH_TYPE: oauth.
    warn.mockClear();
    cfg = legacy({SAP_OAUTH_TOKEN_URL: 'https://idp/token', SAP_OAUTH_CLIENT_ID: 'id', SAP_OAUTH_CLIENT_SECRET: 's' });
    expect(cfg.authType).toBe('oauth');
    expect(cfg.oauth?.clientId).toBe('id');
    // Nothing: sso, silently.
    warn.mockClear();
    expect(legacy({ }).authType).toBe('sso');
    expect(warn).not.toHaveBeenCalled();
    // An explicit SAP_AUTH_TYPE wins, and unused credentials are reported.
    warn.mockClear();
    cfg = legacy({SAP_AUTH_TYPE: 'sso', SAP_USER: 'DEV', SAP_PASSWORD: 'pw' });
    expect(cfg.authType).toBe('sso');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SAP_USER and SAP_PASSWORD are set but the auth mode is sso/));
    expect(warn.mock.calls.join('\n')).not.toContain('pw');
    // An unknown value falls back to sso and says so.
    warn.mockClear();
    expect(legacy({SAP_AUTH_TYPE: 'basc' }).authType).toBe('sso');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SAP_AUTH_TYPE=basc is not one of'));
    warn.mockRestore();
  });

  it('detects inline secrets and file permissions', () => {
    expect(hasInlineSecrets({ DEV: { ...base } })).toBe(true);
    expect(hasInlineSecrets({ DEV: { ...base, password: '${env:PW}' } })).toBe(false);
    expect(hasInlineSecrets({ DEV: { url: 'https://h', authType: 'sso' } })).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'systems-'));
    const file = path.join(dir, 'systems.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    if (process.platform !== 'win32') {
      expect(() => checkConfigFileMode(file, { DEV: { url: 'https://h', authType: 'sso' } })).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('chmod 600'));
      expect(() => checkConfigFileMode(file, { DEV: { ...base } })).toThrow(/Refusing to start/);
      fs.chmodSync(file, 0o600);
      warn.mockClear();
      expect(() => checkConfigFileMode(file, { DEV: { ...base } })).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });
});

describe('authType cert (X.509 client-certificate logon)', () => {
  const certEntry = {
    url: 'https://sap.example.com:44300',
    client: '100',
    authType: 'cert',
    tls: { cert: '/etc/ssl/dev.crt', key: '/etc/ssl/dev.key' },
  };

  it('accepts cert and the x509 alias, and keeps the tls material', () => {
    const systems = readSystems({ SAP_SYSTEMS: JSON.stringify({ A: certEntry, B: { ...certEntry, authType: 'x509' } }) } as any);
    expect(systems.get('A')!.authType).toBe('cert');
    expect(systems.get('B')!.authType).toBe('cert');
    expect(systems.get('A')!.tls).toMatchObject({ cert: '/etc/ssl/dev.crt', key: '/etc/ssl/dev.key' });
  });

  it('refuses a cert destination with no certificate, naming the OS key store alternative', () => {
    expect(() => readSystems({ SAP_SYSTEMS: JSON.stringify({ A: { url: 'https://h', authType: 'cert' } }) } as any))
      .toThrow(/authType=cert requires a client certificate[\s\S]*authType=sso/);
    // A CA alone is not a client certificate.
    expect(() => readSystems({ SAP_SYSTEMS: JSON.stringify({ A: { url: 'https://h', authType: 'cert', tls: { ca: '/ca.pem' } } }) } as any))
      .toThrow(/requires a client certificate/);
  });

  it('accepts a pfx instead of cert plus key', () => {
    const systems = readSystems({ SAP_SYSTEMS: JSON.stringify({ A: { url: 'https://h', authType: 'cert', tls: { pfx: '/id.p12', passphrase: '${env:P}' } } }), P: 'pw' } as any);
    expect(systems.get('A')!.authType).toBe('cert');
    expect(systems.get('A')!.tls!.passphrase).toBe('pw');
  });

  it('reports a password on a cert entry as ignored instead of silently dropping it', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const systems = readSystems({ SAP_SYSTEMS: JSON.stringify({ A: { ...certEntry, user: 'TECH', password: 'pw' } }) } as any);
    expect(systems.get('A')!.password).toBeUndefined();
    expect(systems.get('A')!.user).toBe('TECH');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/authType=cert ignores "password"/));
    expect(warn.mock.calls.join('\n')).not.toContain('pw');
    warn.mockRestore();
  });

  it('counts a key passphrase and an inline private key as inline secrets', () => {
    expect(hasInlineSecrets({ A: { ...certEntry, tls: { ...certEntry.tls, passphrase: 'literal' } } })).toBe(true);
    expect(hasInlineSecrets({ A: { ...certEntry, tls: { ...certEntry.tls, passphrase: '${env:P}' } } })).toBe(false);
    expect(hasInlineSecrets({ A: { ...certEntry, tls: { cert: 'x', key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----' } } })).toBe(true);
    // A path to a key file is guarded by the file's own permissions, not by this check.
    expect(hasInlineSecrets({ A: certEntry })).toBe(false);
  });
});

describe('legacy SAP_TLS_* variables', () => {
  const url = 'https://sap.example.com:44300';
  const legacy = (extra: Record<string, string>) =>
    readSystems({ SAP_URL: url, SAP_SYSTEMS_FILE: '/nonexistent/systems.json', ...extra } as any).get('default')!;

  it('infers cert from a certificate pair and from a pfx', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(legacy({ SAP_TLS_CERT: '/c.crt', SAP_TLS_KEY: '/c.key' }).authType).toBe('cert');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using cert because SAP_TLS_CERT and SAP_TLS_KEY are set'));
    warn.mockClear();
    const cfg = legacy({ SAP_TLS_PFX: '/id.p12', SAP_TLS_PASSPHRASE: 'pw', SAP_TLS_CA: '/ca.pem' });
    expect(cfg.authType).toBe('cert');
    expect(cfg.tls).toMatchObject({ pfx: '/id.p12', passphrase: 'pw', ca: '/ca.pem' });
    warn.mockRestore();
  });

  it('keeps a CA alone on sso: a CA says who to trust, not who you are', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = legacy({ SAP_TLS_CA: '/ca.pem' });
    expect(cfg.authType).toBe('sso');
    expect(cfg.tls).toMatchObject({ ca: '/ca.pem' });
    warn.mockRestore();
  });

  it('prefers basic when a password and a certificate are both configured, and says why', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = legacy({ SAP_USER: 'DEV', SAP_PASSWORD: 'pw', SAP_TLS_CERT: '/c.crt', SAP_TLS_KEY: '/c.key' });
    expect(cfg.authType).toBe('basic');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/client certificate is also configured.*SAP_AUTH_TYPE=cert/));
    expect(warn.mock.calls.join('\n')).not.toContain('pw');
    warn.mockRestore();
  });

  it('an explicit SAP_AUTH_TYPE=cert with no certificate fails at startup, not at the first call', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => legacy({ SAP_AUTH_TYPE: 'cert' })).toThrow(/requires a client certificate/);
    warn.mockRestore();
  });

  it('reports a certificate that the chosen mode does not use as the logon', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(legacy({ SAP_AUTH_TYPE: 'sso', SAP_TLS_PFX: '/id.p12' }).authType).toBe('sso');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/client certificate is configured but the auth mode is sso/));
    warn.mockRestore();
  });
});

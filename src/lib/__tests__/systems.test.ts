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
    expect(() => validateSystem({ name: 'X', url: 'https://h', authType: 'sso2' } as any)).toThrow(/requires sso2.command/);
    expect(() => validateSystem({
      name: 'X', url: 'http://h', authType: 'sso2',
      sso2: { command: '/usr/bin/provider', args: [], timeoutMs: 30_000 },
    } as any)).toThrow(/requires an HTTPS url/);
    expect(() => readSystems({ SAP_SYSTEMS: '{}' } as any)).toThrow(/empty/);
    expect(() => readSystems({ SAP_SYSTEMS: JSON.stringify({ DEV: { ...base, url: 'ftp://x' } }) } as any)).toThrow(/DEV/);
  });

  it('parses an opt-in SSO2 provider without changing the existing auth modes', () => {
    const command = path.resolve('/opt/local/bin/sap-sso2-provider');
    const systems = readSystems({ SAP_SYSTEMS: JSON.stringify({
      QAS: {
        url: 'https://sap.example.com:44300', client: '100', authType: 'sso2',
        sso2: { command, args: ['--system', 'QAS', '--user', 'DEVELOPER'], timeoutMs: 15_000 },
      },
      DEV: { url: 'https://dev.example.com:44300', client: '100', authType: 'sso' },
    }) } as any);
    expect(systems.get('QAS')).toMatchObject({
      authType: 'sso2', sso2: { command, args: ['--system', 'QAS', '--user', 'DEVELOPER'], timeoutMs: 15_000 },
    });
    expect(systems.get('DEV')!.authType).toBe('sso');

    const legacy = readSystems({
      SAP_URL: 'https://sap.example.com:44300', SAP_CLIENT: '100', SAP_AUTH_TYPE: 'sso2',
      SAP_SSO2_COMMAND: command, SAP_SSO2_ARGS: '["--system","QAS"]', SAP_SSO2_TIMEOUT_MS: '20000',
      SAP_SYSTEMS_FILE: '/nonexistent/systems.json',
    } as any).get('default')!;
    expect(legacy).toMatchObject({
      authType: 'sso2', sso2: { command, args: ['--system', 'QAS'], timeoutMs: 20_000 },
    });
  });

  it('rejects unsafe or malformed SSO2 provider configuration', () => {
    const entry = (sso2: any) => ({ SAP_SYSTEMS: JSON.stringify({
      X: { url: 'https://sap.example.com:44300', authType: 'sso2', sso2 },
    }) } as any);
    expect(() => readSystems(entry({ command: 'provider-on-path' }))).toThrow(/absolute executable path/);
    expect(() => readSystems(entry({ command: '/usr/bin/provider', args: '--system QAS' }))).toThrow(/array of strings/);
    expect(() => readSystems(entry({ command: '/usr/bin/provider', timeoutMs: 999 }))).toThrow(/1000 to 300000/);
    expect(() => readSystems({ SAP_SYSTEMS: JSON.stringify({
      X: {
        url: 'http://sap.example.com:8000', authType: 'sso2',
        sso2: { command: '/usr/bin/provider' },
      },
    }) } as any)).toThrow(/requires an HTTPS url/);
    expect(() => readSystems({
      SAP_URL: 'https://sap.example.com:44300', SAP_AUTH_TYPE: 'sso2', SAP_SSO2_COMMAND: '/usr/bin/provider',
      SAP_SSO2_ARGS: 'not-json', SAP_SYSTEMS_FILE: '/nonexistent/systems.json',
    } as any)).toThrow(/SAP_SSO2_ARGS must be a JSON array/);
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

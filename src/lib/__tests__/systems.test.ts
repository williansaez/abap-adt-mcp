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

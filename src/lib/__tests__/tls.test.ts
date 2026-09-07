import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import { parseTlsConfig, loadPemMaterial, buildHttpsAgent, describeTls, enforceTlsVerification } from '../tls';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('tls', () => {
  it('parses and validates the tls block', () => {
    expect(parseTlsConfig(undefined)).toBeUndefined();
    expect(parseTlsConfig({})).toBeUndefined();
    expect(parseTlsConfig({ ca: '/etc/ca.pem' })).toEqual({ ca: '/etc/ca.pem', cert: undefined, key: undefined, pfx: undefined, passphrase: undefined, servername: undefined });
    expect(parseTlsConfig({ servername: 'sap.example.com' })!.servername).toBe('sap.example.com');
    expect(parseTlsConfig({ servername: '  ' })).toBeUndefined();
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
    const sni: any = buildHttpsAgent({ servername: 'sap.example.com' }, false);
    expect(sni.options.servername).toBe('sap.example.com');
    expect(sni.options.rejectUnauthorized).toBe(true);
    expect(describeTls({ ca: PEM, servername: 'sap.example.com' }, false)).toBe('custom CA, servername sap.example.com');
  });

  describe('servername against a real handshake', () => {
    // A self-signed certificate for sap.example.com, minted here so no private
    // key lives in the repository; skipped where openssl is not on PATH.
    let cert: Buffer | undefined;
    let key: Buffer | undefined;
    let server: https.Server | undefined;
    let port = 0;

    beforeAll((done) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-sni-'));
      try {
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'),
          '-out', path.join(dir, 'cert.pem'), '-days', '2', '-subj', '/CN=sap.example.com', '-addext', 'subjectAltName=DNS:sap.example.com'], { stdio: 'ignore' });
      } catch {
        done();
        return;
      }
      cert = fs.readFileSync(path.join(dir, 'cert.pem'));
      key = fs.readFileSync(path.join(dir, 'key.pem'));
      server = https.createServer({ cert, key }, (_req, res) => res.end('ok'));
      server.listen(0, '127.0.0.1', () => { port = (server!.address() as any).port; done(); });
    });
    afterAll((done) => { server ? server.close(() => done()) : done(); });

    const get = (agent: https.Agent) => new Promise<{ status?: number; code?: string }>((resolve) => {
      https.get({ host: '127.0.0.1', port, path: '/', agent }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); })
        .on('error', (e: any) => resolve({ code: e.code }));
    });

    it('fails on the name with the correct CA alone, and passes once servername names the certificate', async () => {
      if (!cert) return; // openssl unavailable: nothing to assert against
      const pem = cert.toString();
      // The CA is right, the name is not: this is the by-IP landscape of issue #13.
      expect(await get(buildHttpsAgent({ ca: pem }, false))).toEqual({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      // Same CA, now verified against the name the certificate carries. Still rejectUnauthorized: true.
      expect(await get(buildHttpsAgent({ ca: pem, servername: 'sap.example.com' }, false))).toEqual({ status: 200 });
      // servername is not a trust decision: without the CA the issuer still fails.
      expect(await get(buildHttpsAgent({ servername: 'sap.example.com' }, false))).toEqual({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    });
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

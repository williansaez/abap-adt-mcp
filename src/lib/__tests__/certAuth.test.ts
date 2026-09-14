/**
 * The transport half of authType=cert, proven against a real TLS server that
 * demands a client certificate, the way an ICM with icm/HTTPS/verify_client
 * does. No SAP system is involved: what is under test is that the destination's
 * agent presents the configured identity, that a destination without one is
 * refused by the handshake, and that the failure carries the hint naming the
 * two ways to answer it.
 *
 * The certificates are generated in the test with openssl and thrown away with
 * the temporary directory, so nothing is committed and nothing expires.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { classifyAdtError } from '../adtErrorHints';
import { buildHttpsAgent } from '../tls';

/** Minimal CA plus one leaf certificate usable as both server and client identity. */
function makePki(dir: string) {
  const sh = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem',
    '-days', '1', '-subj', '/CN=Test CA']);
  for (const [name, cn] of [['server', 'localhost'], ['client', 'TECHUSER']]) {
    sh(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${cn}`]);
    const ext = path.join(dir, `${name}.ext`);
    fs.writeFileSync(ext, name === 'server' ? 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n' : 'extendedKeyUsage=clientAuth\n');
    sh(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', `${name}.crt`, '-days', '1', '-extfile', ext]);
  }
  const p = (f: string) => path.join(dir, f);
  return { ca: p('ca.pem'), serverCert: p('server.crt'), serverKey: p('server.key'), clientCert: p('client.crt'), clientKey: p('client.key') };
}

function hasOpenssl(): boolean {
  try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

const describeIfOpenssl = hasOpenssl() ? describe : describe.skip;

describeIfOpenssl('authType cert against a server that requires a client certificate', () => {
  let dir: string;
  let pki: ReturnType<typeof makePki>;
  let server: https.Server;
  let url: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-adt-mcp-cert-'));
    pki = makePki(dir);
    server = https.createServer({
      cert: fs.readFileSync(pki.serverCert),
      key: fs.readFileSync(pki.serverKey),
      ca: fs.readFileSync(pki.ca),
      // What icm/HTTPS/verify_client = 2 does: ask for a certificate, refuse the
      // handshake when none arrives.
      requestCert: true,
      rejectUnauthorized: true,
    }, (req, res) => {
      const cert = (req.socket as any).getPeerCertificate?.();
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<ok subject="${cert?.subject?.CN ?? ''}"/>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://localhost:${(server.address() as any).port}/sap/bc/adt/core/discovery`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const get = (agent: https.Agent) => new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });

  it('logs on with the configured client certificate, and the server sees its subject', async () => {
    const agent = buildHttpsAgent({ ca: pki.ca, cert: pki.clientCert, key: pki.clientKey, servername: 'localhost' }, false);
    const res = await get(agent);
    expect(res.status).toBe(200);
    expect(res.body).toContain('subject="TECHUSER"');
    agent.destroy();
  });

  it('is refused by the handshake when the destination carries no certificate, and the hint names both answers', async () => {
    const agent = buildHttpsAgent({ ca: pki.ca, servername: 'localhost' }, false);
    const err = await get(agent).then(() => undefined, (e) => e);
    agent.destroy();
    expect(err).toBeDefined();

    const cls = classifyAdtError(err, { destination: 'ONPREM', url, authType: 'cert' });
    expect(cls.kind).toBe('tlsCertificate');
    expect(cls.hint).toMatch(/"authType": "sso"/);
    expect(cls.hint).toMatch(/"authType": "cert"/);
  });

  it('still verifies the server: an unknown issuer fails even with a valid client certificate', async () => {
    const agent = buildHttpsAgent({ cert: pki.clientCert, key: pki.clientKey, servername: 'localhost' }, false);
    const err: any = await get(agent).then(() => undefined, (e) => e);
    agent.destroy();
    expect(err).toBeDefined();
    const cls = classifyAdtError(err, { destination: 'ONPREM', url, authType: 'cert' });
    expect(cls.kind).toBe('tlsCertificate');
    expect(cls.hint).toMatch(/tls\.ca/);
  });
});

describe('a 401 on a certificate destination is a mapping problem, not an expired session', () => {
  it('replaces the re-login hint with the CERTRULE one', () => {
    const err = { message: 'Request failed with status code 401', status: 401 };
    const asCert = classifyAdtError(err, { destination: 'ONPREM', url: 'https://sap.example.com:44300', authType: 'cert' });
    expect(asCert.kind).toBe('sessionExpired');
    expect(asCert.hint).toMatch(/CERTRULE/);
    expect(asCert.hint).toMatch(/Re-authenticating will not help/);
    expect(asCert.nextTools).not.toContain('login');

    // Every other mode keeps the standard hint, which does tell the model to log in again.
    const asSso = classifyAdtError(err, { destination: 'CLOUD', url: 'https://x', authType: 'sso' });
    expect(asSso.hint).toMatch(/re-authenticates and retries once/);
    expect(asSso.nextTools).toContain('login');
  });
});

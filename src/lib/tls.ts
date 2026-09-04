/**
 * Per-destination TLS material: CA bundle, client certificate and key (X.509
 * mutual TLS, common in front of on-prem ABAP systems behind a reverse proxy
 * or with SNC-like setups), optional passphrase, and the insecure switch.
 * Values are file paths (PEM/CRT/KEY) or inline PEM text; ${env:VAR} was
 * already resolved by the systems loader.
 */
import fs from 'fs';
import https from 'https';

export interface TlsConfig {
  ca?: string;
  cert?: string;
  key?: string;
  pfx?: string;
  passphrase?: string;
}

export function parseTlsConfig(raw: any): TlsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const pick = (k: string) => (typeof raw[k] === 'string' && raw[k].trim() ? String(raw[k]) : undefined);
  const cfg: TlsConfig = { ca: pick('ca'), cert: pick('cert'), key: pick('key'), pfx: pick('pfx'), passphrase: pick('passphrase') };
  if (cfg.cert && !cfg.key && !cfg.pfx) throw new Error('tls.cert requires tls.key');
  if (cfg.key && !cfg.cert) throw new Error('tls.key requires tls.cert');
  return Object.values(cfg).some(v => v !== undefined) ? cfg : undefined;
}

/** File path or inline PEM: inline when it contains a PEM header, otherwise read the file. */
export function loadPemMaterial(value: string | undefined, what: string): string | Buffer | undefined {
  if (!value) return undefined;
  if (/-----BEGIN [A-Z ]+-----/.test(value)) return value;
  try {
    return fs.readFileSync(value);
  } catch (e: any) {
    throw new Error(`tls.${what}: cannot read ${value}: ${e.message}`);
  }
}

/**
 * NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate verification off for every
 * outbound connection of the process: the ADT calls, the OAuth token request and
 * the cloudification repository download alike. It is a global, silent bypass
 * that a destination never asked for, and a warning on stderr is not enough when
 * the server speaks over stdio and nobody reads stderr. Remove it before
 * anything connects, so the default is always "verify". Turning verification off
 * stays possible with "insecureTls", which says on which destination.
 *
 * Node acts on the literal string "0" only; any other value already verifies, so
 * only that one is worth removing. Returns whether a bypass was removed, for the
 * caller to report.
 */
export function enforceTlsVerification(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') return false;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  return true;
}

/**
 * https.Agent for a destination, always. A destination that configured nothing
 * still gets an agent that says rejectUnauthorized: true, rather than falling
 * back to Node's global default: an explicit value wins over
 * NODE_TLS_REJECT_UNAUTHORIZED, so the decision to verify travels with the
 * destination instead of depending on the environment the server happens to run
 * in. Turning verification off is then a choice that has to name a destination.
 */
export function buildHttpsAgent(tls: TlsConfig | undefined, insecureTls: boolean | undefined): https.Agent {
  const options: https.AgentOptions = { keepAlive: true, rejectUnauthorized: !insecureTls };
  if (tls) {
    const ca = loadPemMaterial(tls.ca, 'ca');
    const cert = loadPemMaterial(tls.cert, 'cert');
    const key = loadPemMaterial(tls.key, 'key');
    const pfx = tls.pfx ? loadPemMaterial(tls.pfx, 'pfx') : undefined;
    if (ca) options.ca = ca;
    if (cert) options.cert = cert;
    if (key) options.key = key;
    if (pfx) options.pfx = pfx;
    if (tls.passphrase) options.passphrase = tls.passphrase;
  }
  return new https.Agent(options);
}

export function describeTls(tls: TlsConfig | undefined, insecureTls: boolean | undefined): string | undefined {
  const parts: string[] = [];
  if (tls?.ca) parts.push('custom CA');
  if (tls?.cert || tls?.pfx) parts.push('client certificate');
  if (insecureTls) parts.push('verification disabled');
  return parts.length ? parts.join(', ') : undefined;
}

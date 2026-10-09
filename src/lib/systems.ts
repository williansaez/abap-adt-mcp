/**
 * Multi-system ("destination") configuration.
 *
 * A single MCP server instance can talk to many ABAP systems. Each system is a
 * named destination; tools receive a `destination` argument to pick one. This
 * mirrors the SAP RFC/HTTP "destination" concept and keeps one server (one set
 * of tools) instead of one server per system.
 *
 * Resolution order:
 *   1. SAP_SYSTEMS         — inline JSON map in the environment
 *   2. SAP_SYSTEMS_FILE    — path to a JSON file with the same shape
 *   3. <repo>/systems.json — auto-detected next to the build
 *   4. SAP_URL/SAP_CLIENT… — a single implicit destination (back-compat)
 */

import fs from 'fs';
import path from 'path';
import { readOAuthConfig, OAuthConfig } from './oauth.js';
import { parsePolicy, SystemPolicy } from './policy.js';
import { parseTlsConfig, TlsConfig } from './tls.js';
import type { RfcDestinationConfig } from './rfc/types.js';

export type AuthType = 'sso' | 'sso2' | 'basic' | 'oauth';

/** How ADT requests reach the system: HTTP(S) (default) or RFC (on-premise SAP_BASIS below 7.51, see lib/rfc). */
export type Transport = 'http' | 'rfc';

/** Keys of the systems.json "rfc" block; every value is a string. */
const RFC_KEYS: ReadonlyArray<keyof RfcDestinationConfig> = ['ashost', 'sysnr', 'mshost', 'sysid', 'group', 'msserv', 'saprouter', 'gwhost', 'gwserv', 'sdkPath', 'sessions'];

/**
 * Trusted local program that obtains a short-lived SAP logon/assertion ticket.
 * The program must print exactly one JSON object to stdout: {"ticket":"..."}.
 * Its stdout and stderr are never copied into MCP responses or diagnostics.
 */
export interface Sso2ProviderConfig {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface SystemConfig {
  name: string;
  url: string;
  client?: string;
  language?: string;
  authType: AuthType;
  // basic
  user?: string;
  password?: string;
  // oauth
  oauth?: OAuthConfig;
  // browser sso / external RFC-to-SSO2 bridge
  sso2?: Sso2ProviderConfig;
  insecureTls?: boolean;
  // abapGit remote credentials (backfilled into git tools when omitted, so
  // they never have to pass through the model context)
  gitUser?: string;
  gitPassword?: string;
  /** Marks this destination as the default when a tool call omits `destination`. */
  default?: boolean;
  /** Server-side guard rails for this destination (see lib/policy.ts). */
  policy?: SystemPolicy;
  /** CA bundle, client certificate/key or PFX for this destination (see lib/tls.ts). */
  tls?: TlsConfig;
  /** 'rfc' carries ADT over SADT_REST_RFC_ENDPOINT; omitted means 'http'. */
  transport?: Transport;
  /** RFC connection settings, used when transport is 'rfc'. */
  rfc?: RfcDestinationConfig;
}

/**
 * Replace ${env:VAR} (and ${VAR}) references in every string of the raw
 * configuration with the environment value; a missing variable is an error
 * that names the variable but never its value.
 */
export function resolveEnvRefs<T>(value: T, env: NodeJS.ProcessEnv, where = 'systems'): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      const v = env[name];
      if (v === undefined) throw new Error(`${where}: environment variable ${name} referenced by \${env:${name}} is not set`);
      return v;
    }) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveEnvRefs(v, env, `${where}[${i}]`)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = resolveEnvRefs(v, env, `${where}.${k}`);
    return out;
  }
  return value;
}

/** Fail early on configurations that would only break at the first call. */
export function validateSystem(cfg: SystemConfig): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cfg.url);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error('protocol');
  } catch {
    throw new Error(`System "${cfg.name}": url "${cfg.url}" is not a valid http(s) URL`);
  }
  if (cfg.client !== undefined && !/^\d{3}$/.test(cfg.client)) {
    throw new Error(`System "${cfg.name}": client must be a 3-digit number, got "${cfg.client}"`);
  }
  if (cfg.authType === 'basic' && (!cfg.user || !cfg.password)) {
    throw new Error(`System "${cfg.name}": authType=basic requires user and password (use \${env:VAR} to keep them out of the file)`);
  }
  if (cfg.authType === 'sso2' && !cfg.sso2) {
    throw new Error(`System "${cfg.name}": authType=sso2 requires sso2.command`);
  }
  if (cfg.authType === 'sso2' && parsedUrl.protocol !== 'https:') {
    throw new Error(`System "${cfg.name}": authType=sso2 requires an HTTPS url so the ticket is never sent in plaintext`);
  }
  // HTTPS alone is not the guarantee: with verification off, anything that can
  // answer on that name collects a live logon ticket. The other modes can be
  // told to trust a self-signed test host; a ticket is a credential this server
  // hands over before it knows who it is talking to, so the pair is refused.
  if (cfg.authType === 'sso2' && cfg.insecureTls) {
    throw new Error(`System "${cfg.name}": authType=sso2 cannot be combined with insecureTls; the ticket would be handed to an unverified server. Give the destination its CA bundle with tls.ca instead`);
  }
  if (cfg.transport !== undefined && cfg.transport !== 'http' && cfg.transport !== 'rfc') {
    throw new Error(`System "${cfg.name}": transport must be "http" or "rfc", got "${cfg.transport}"`);
  }
  if (cfg.transport === 'rfc') validateRfc(cfg);
}

/** Rules of transport "rfc"; url stays required (browser SSO ticket, display). */
function validateRfc(cfg: SystemConfig): void {
  const rfc = cfg.rfc || {};
  const where = `System "${cfg.name}" (transport rfc)`;
  if (!(rfc.ashost && rfc.sysnr) && !(rfc.mshost && rfc.sysid)) {
    throw new Error(`${where}: needs rfc.ashost and rfc.sysnr (direct logon to an application server) or rfc.mshost and rfc.sysid (logon through the message server)`);
  }
  if (rfc.sysnr !== undefined && !/^\d{2}$/.test(rfc.sysnr)) {
    throw new Error(`${where}: rfc.sysnr must be the two-digit instance number, e.g. "00", got "${rfc.sysnr}"`);
  }
  if (!cfg.client) {
    throw new Error(`${where}: client is required; an RFC logon always names its client`);
  }
  if (cfg.authType !== 'basic' && cfg.authType !== 'sso' && cfg.authType !== 'sso2') {
    throw new Error(`${where}: authType ${cfg.authType} is not supported over RFC; use basic, sso or sso2 (OAuth tokens cannot log on to an RFC connection)`);
  }
  if (rfc.sessions !== undefined && rfc.sessions !== 'split' && rfc.sessions !== 'single') {
    throw new Error(`${where}: rfc.sessions must be "split" or "single", got "${rfc.sessions}"`);
  }
}

/** Configuration warnings, printed once per process (Streamable HTTP mode reads the file per session). */
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

function parseTransport(raw: unknown): Transport | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  return String(raw).trim().toLowerCase() as Transport;
}

/** The "rfc" block: known keys only, string values, trimmed; empty strings count as absent. */
function parseRfcConfig(raw: unknown, name: string): RfcDestinationConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`System "${name}": rfc must be an object`);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith('_')) continue;
    if (!(RFC_KEYS as readonly string[]).includes(key)) {
      throw new Error(`System "${name}": rfc.${key} is not a known key (${RFC_KEYS.join(', ')})`);
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new Error(`System "${name}": rfc.${key} must be a string${key === 'sysnr' ? ' such as "00"' : ''}`);
    }
    const v = value.trim();
    if (v) out[key] = v;
  }
  return out as RfcDestinationConfig;
}

/** True when the raw config carries inline secrets (not env references). */
export function hasInlineSecrets(raw: any): boolean {
  const isRef = (v: unknown) => typeof v === 'string' && /^\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}$/.test(v);
  for (const entry of Object.values(raw || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const e: any = entry;
    for (const v of [e.password, e.gitPassword, e.oauth?.clientSecret]) {
      if (typeof v === 'string' && v.length > 0 && !isRef(v)) return true;
    }
  }
  return false;
}

/** Warn on group/world-readable config files; refuse them when they hold inline secrets. */
export function checkConfigFileMode(filePath: string, raw: any): void {
  if (process.platform === 'win32') return;
  let mode: number;
  try { mode = fs.statSync(filePath).mode & 0o777; } catch { return; }
  if ((mode & 0o077) === 0) return;
  const msg = `[abap-adt-mcp] ${filePath} is readable by other users (mode ${mode.toString(8)}); run: chmod 600 ${filePath}`;
  if (hasInlineSecrets(raw)) {
    throw new Error(`${msg}. Refusing to start with inline passwords in a shared-readable file (or reference them as \${env:VAR}).`);
  }
  console.error(`${msg}`);
}

function coerceAuthType(v: any, fallback: AuthType): AuthType {
  const s = String(v || '').toLowerCase();
  if (s === 'sso' || s === 'browser') return 'sso';
  if (s === 'sso2' || s === 'ticket') return 'sso2';
  if (s === 'basic') return 'basic';
  if (s === 'oauth') return 'oauth';
  return fallback;
}

function parseSso2Provider(raw: any, name: string): Sso2ProviderConfig {
  if (!raw || typeof raw.command !== 'string' || !raw.command.trim()) {
    throw new Error(`System "${name}" authType=sso2 requires sso2.command`);
  }
  if (!path.isAbsolute(raw.command)) {
    throw new Error(`System "${name}": sso2.command must be an absolute executable path`);
  }
  if (raw.command.includes('\0')) {
    throw new Error(`System "${name}": sso2.command contains an invalid NUL character`);
  }
  const args = raw.args === undefined ? [] : raw.args;
  if (!Array.isArray(args) || args.some((arg: unknown) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error(`System "${name}": sso2.args must be an array of strings without NUL characters`);
  }
  const timeoutMs = raw.timeoutMs === undefined ? 30_000 : Number(raw.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error(`System "${name}": sso2.timeoutMs must be an integer from 1000 to 300000`);
  }
  return { command: raw.command, args: [...args], timeoutMs };
}

function fromRawEntry(name: string, raw: any, defaultAuth: AuthType): SystemConfig {
  if (!raw || !raw.url) {
    throw new Error(`System "${name}" is missing "url"`);
  }
  const authType = coerceAuthType(raw.authType ?? raw.auth, defaultAuth);
  const cfg: SystemConfig = {
    name,
    url: raw.url,
    client: raw.client != null ? String(raw.client) : undefined,
    language: raw.language,
    authType,
    insecureTls: raw.insecureTls === true || /^(1|true|yes)$/i.test(String(raw.insecureTls || '')),
    gitUser: raw.gitUser,
    gitPassword: raw.gitPassword,
    default: raw.default === true || /^(1|true|yes)$/i.test(String(raw.default || '')),
    policy: parsePolicy(raw.policy),
    tls: (() => { try { return parseTlsConfig(raw.tls); } catch (e: any) { throw new Error(`System "${name}": ${e.message}`); } })(),
  };
  // "transport" and "rfc" were ignored before the RFC transport existed, so an
  // entry that happens to carry them must keep loading as an HTTP destination:
  // only "rfc" switches the transport, and the rfc block is read only then.
  const transport = parseTransport(raw.transport);
  if (transport === 'rfc' || transport === 'http') {
    cfg.transport = transport;
  } else if (transport !== undefined) {
    warnOnce(`[abap-adt-mcp] System "${name}": transport ${JSON.stringify(raw.transport)} is neither "http" nor "rfc"; ignored, the destination uses HTTP.`);
  }
  if (cfg.transport === 'rfc') {
    const rfc = parseRfcConfig(raw.rfc, name);
    if (rfc !== undefined) cfg.rfc = rfc;
  } else if (raw.rfc !== undefined && raw.rfc !== null) {
    warnOnce(`[abap-adt-mcp] System "${name}": the "rfc" block is ignored because "transport" is not "rfc".`);
  }
  if (authType === 'basic') {
    cfg.user = raw.user;
    cfg.password = raw.password;
  } else if (authType === 'sso2') {
    cfg.sso2 = parseSso2Provider(raw.sso2, name);
  } else if (authType === 'oauth') {
    if (raw.oauth?.tokenUrl && raw.oauth?.clientId && raw.oauth?.clientSecret) {
      cfg.oauth = {
        tokenUrl: raw.oauth.tokenUrl,
        clientId: raw.oauth.clientId,
        clientSecret: raw.oauth.clientSecret,
        scope: raw.oauth.scope,
      };
    } else {
      throw new Error(`System "${name}" authType=oauth requires oauth.tokenUrl/clientId/clientSecret`);
    }
  }
  return cfg;
}

function parseMap(obj: Record<string, any>, defaultAuth: AuthType, env: NodeJS.ProcessEnv): Map<string, SystemConfig> {
  const map = new Map<string, SystemConfig>();
  for (const [name, raw] of Object.entries(obj)) {
    if (name.startsWith('_')) continue; // comment/metadata keys like "_comment"
    const cfg = fromRawEntry(name, resolveEnvRefs(raw, env, `systems.${name}`), defaultAuth);
    validateSystem(cfg);
    map.set(name, cfg);
  }
  if (map.size === 0) throw new Error('No ABAP systems configured: the systems map is empty');
  return map;
}

/** Read the configured systems. Throws if the configuration is present but invalid. */
export function readSystems(env: NodeJS.ProcessEnv = process.env): Map<string, SystemConfig> {
  const systems = readSystemsRaw(env);
  // MCP_READ_ONLY=1 turns every destination read-only regardless of its own policy.
  if (/^(1|true|yes)$/i.test(String(env.MCP_READ_ONLY || ''))) {
    for (const cfg of systems.values()) cfg.policy = { ...(cfg.policy || {}), readOnly: true };
  }
  // Data access is closed unless a destination opens it. MCP_ALLOW_DATA_PREVIEW=1
  // and MCP_ALLOW_FREE_SQL=1 set the default for destinations that do not state
  // the key; a destination that states false keeps its own answer.
  const dataDefaults: Array<['allowDataPreview' | 'allowFreeSql', string]> = [['allowDataPreview', 'MCP_ALLOW_DATA_PREVIEW'], ['allowFreeSql', 'MCP_ALLOW_FREE_SQL']];
  for (const [key, variable] of dataDefaults) {
    if (!/^(1|true|yes)$/i.test(String(env[variable] || ''))) continue;
    for (const cfg of systems.values()) {
      if (cfg.policy?.[key] === undefined) cfg.policy = { ...(cfg.policy || {}), [key]: true };
    }
  }
  return systems;
}

function readSystemsRaw(env: NodeJS.ProcessEnv): Map<string, SystemConfig> {
  // Default auth for entries that don't specify one: sso unless the top-level
  // SAP_AUTH_TYPE says otherwise.
  const defaultAuth = coerceAuthType(env.SAP_AUTH_TYPE, 'sso');

  if (env.SAP_SYSTEMS) {
    let obj: any;
    try {
      obj = JSON.parse(env.SAP_SYSTEMS);
    } catch (e: any) {
      throw new Error(`SAP_SYSTEMS is not valid JSON: ${e.message}`);
    }
    return parseMap(obj, defaultAuth, env);
  }

  const filePath = env.SAP_SYSTEMS_FILE || path.resolve(__dirname, '../../systems.json');
  if (fs.existsSync(filePath)) {
    let obj: any;
    try {
      obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e: any) {
      throw new Error(`${filePath} is not valid JSON: ${e.message}`);
    }
    checkConfigFileMode(filePath, obj);
    return parseMap(obj, defaultAuth, env);
  }

  // Back-compat: a single implicit destination from the flat env vars.
  if (env.SAP_URL) {
    const name = env.SAP_DEFAULT_DESTINATION || 'default';
    const authType = legacyAuthType(env, defaultAuth);
    const oauth = authType === 'oauth' ? readOAuthConfig(env) : undefined;
    const sso2 = authType === 'sso2' ? parseSso2Provider({
      command: env.SAP_SSO2_COMMAND,
      args: env.SAP_SSO2_ARGS ? (() => {
        try { return JSON.parse(env.SAP_SSO2_ARGS); }
        catch { throw new Error('SAP_SSO2_ARGS must be a JSON array of strings'); }
      })() : [],
      timeoutMs: env.SAP_SSO2_TIMEOUT_MS,
    }, name) : undefined;
    const map = new Map<string, SystemConfig>();
    const cfg: SystemConfig = {
      name,
      url: env.SAP_URL,
      client: env.SAP_CLIENT,
      language: env.SAP_LANGUAGE,
      authType,
      user: env.SAP_USER,
      password: env.SAP_PASSWORD,
      oauth,
      sso2,
      insecureTls: /^(1|true|yes)$/i.test(env.SAP_TLS_INSECURE || ''),
    };
    // The map form has always been validated here; the legacy variables were
    // not, so the rules that keep a ticket off a plaintext or unverified
    // connection would have applied to systems.json only.
    validateSystem(cfg);
    map.set(name, cfg);
    return map;
  }

  throw new NoSystemsConfiguredError(filePath);
}

/**
 * Nothing describes a system yet: no SAP_SYSTEMS, no systems file, no SAP_URL.
 * The server catches it and starts in setup mode (only listSystems and
 * healthcheck, both saying what to do) instead of exiting, so a fresh plugin
 * install shows as connected rather than failed.
 */
export class NoSystemsConfiguredError extends Error {
  constructor(public readonly systemsFile: string) {
    super(
      `No ABAP systems configured: ${systemsFile} does not exist. ` +
      'Ask the agent to set up abap-adt-mcp (skill abap-adt-mcp-setup) or write the file by hand ' +
      '(docs/CONFIGURATION.md; SAP_SYSTEMS or SAP_URL work too), then restart the MCP server ' +
      '(/reload-plugins in Claude Code).'
    );
    this.name = 'NoSystemsConfiguredError';
  }
}

/**
 * Auth mode of the legacy single-system setup (SAP_URL and friends). An explicit
 * SAP_AUTH_TYPE wins. Without one, the credentials present decide: the three
 * SAP_OAUTH_* variables mean oauth, SAP_USER plus SAP_PASSWORD mean basic, and
 * nothing means sso. Credentials the chosen mode will not use are reported on
 * stderr: a password login that silently loads as sso shows the user a browser
 * window against an on-prem host and a 300 s timeout instead of an error.
 */
export function legacyAuthType(env: NodeJS.ProcessEnv, defaultAuth: AuthType): AuthType {
  const raw = String(env.SAP_AUTH_TYPE || '').trim();
  const hasBasic = !!(env.SAP_USER && env.SAP_PASSWORD);
  const hasOAuth = !!(env.SAP_OAUTH_TOKEN_URL && env.SAP_OAUTH_CLIENT_ID && env.SAP_OAUTH_CLIENT_SECRET);
  let authType: AuthType;
  if (raw) {
    authType = coerceAuthType(raw, defaultAuth);
    if (authType !== raw.toLowerCase() && !['browser', 'ticket'].includes(raw.toLowerCase())) {
      console.error(`SAP_AUTH_TYPE=${raw} is not one of sso, sso2, basic, oauth; using ${authType}.`);
    }
  } else if (hasOAuth) {
    authType = 'oauth';
    console.error('SAP_AUTH_TYPE not set; using oauth because SAP_OAUTH_TOKEN_URL, SAP_OAUTH_CLIENT_ID and SAP_OAUTH_CLIENT_SECRET are set.');
  } else if (hasBasic) {
    authType = 'basic';
    console.error('SAP_AUTH_TYPE not set; using basic because SAP_USER and SAP_PASSWORD are set.');
  } else {
    authType = 'sso';
  }
  if (authType !== 'basic' && hasBasic) {
    console.error(`SAP_USER and SAP_PASSWORD are set but the auth mode is ${authType}: the password is not used. Set SAP_AUTH_TYPE=basic for password logins.`);
  }
  if (authType !== 'oauth' && hasOAuth) {
    console.error(`SAP_OAUTH_* variables are set but the auth mode is ${authType}: the OAuth client is not used. Set SAP_AUTH_TYPE=oauth for client-credentials logins.`);
  }
  return authType;
}

/** The default destination to use when a tool call omits one. */
export function defaultDestination(
  systems: Map<string, SystemConfig>,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env.SAP_DEFAULT_DESTINATION && systems.has(env.SAP_DEFAULT_DESTINATION)) {
    return env.SAP_DEFAULT_DESTINATION;
  }
  for (const [name, cfg] of systems) {
    if (cfg.default) return name;
  }
  return systems.size === 1 ? [...systems.keys()][0] : undefined;
}

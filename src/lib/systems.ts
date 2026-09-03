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

export type AuthType = 'sso' | 'basic' | 'oauth';

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
  // sso
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
  try {
    const u = new URL(cfg.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  } catch {
    throw new Error(`System "${cfg.name}": url "${cfg.url}" is not a valid http(s) URL`);
  }
  if (cfg.client !== undefined && !/^\d{3}$/.test(cfg.client)) {
    throw new Error(`System "${cfg.name}": client must be a 3-digit number, got "${cfg.client}"`);
  }
  if (cfg.authType === 'basic' && (!cfg.user || !cfg.password)) {
    throw new Error(`System "${cfg.name}": authType=basic requires user and password (use \${env:VAR} to keep them out of the file)`);
  }
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
  if (s === 'basic') return 'basic';
  if (s === 'oauth') return 'oauth';
  return fallback;
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
  if (authType === 'basic') {
    cfg.user = raw.user;
    cfg.password = raw.password;
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
    const oauth = defaultAuth === 'oauth' ? readOAuthConfig(env) : undefined;
    const map = new Map<string, SystemConfig>();
    map.set(name, {
      name,
      url: env.SAP_URL,
      client: env.SAP_CLIENT,
      language: env.SAP_LANGUAGE,
      authType: defaultAuth,
      user: env.SAP_USER,
      password: env.SAP_PASSWORD,
      oauth,
      insecureTls: /^(1|true|yes)$/i.test(env.SAP_TLS_INSECURE || ''),
    });
    return map;
  }

  throw new Error(
    'No ABAP systems configured. Provide systems.json, SAP_SYSTEMS, SAP_SYSTEMS_FILE, or SAP_URL.'
  );
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

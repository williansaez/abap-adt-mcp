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

function parseMap(obj: Record<string, any>, defaultAuth: AuthType): Map<string, SystemConfig> {
  const map = new Map<string, SystemConfig>();
  for (const [name, raw] of Object.entries(obj)) {
    if (name.startsWith('_')) continue; // comment/metadata keys like "_comment"
    map.set(name, fromRawEntry(name, raw, defaultAuth));
  }
  return map;
}

/** Read the configured systems. Throws if the configuration is present but invalid. */
export function readSystems(env: NodeJS.ProcessEnv = process.env): Map<string, SystemConfig> {
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
    return parseMap(obj, defaultAuth);
  }

  const filePath = env.SAP_SYSTEMS_FILE || path.resolve(__dirname, '../../systems.json');
  if (fs.existsSync(filePath)) {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parseMap(obj, defaultAuth);
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

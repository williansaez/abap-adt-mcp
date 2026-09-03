/**
 * OAuth2 bearer-token support for ADT access on S/4HANA Cloud (and any
 * OAuth-protected ABAP system).
 *
 * The abap-adt-api ADTClient accepts a BearerFetcher (`() => Promise<string>`)
 * in place of a password; when present it sends `Authorization: bearer <token>`
 * on every request. This module builds such a fetcher from environment
 * configuration, caching the token until shortly before it expires.
 *
 * Only the client_credentials grant is implemented — the standard machine-to-
 * machine flow for a Communication Arrangement / registered OAuth client.
 */

export interface OAuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Read OAuth config from environment, or return undefined when not in OAuth mode. */
export function readOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | undefined {
  const authType = (env.SAP_AUTH_TYPE || '').toLowerCase();
  const hasOAuthVars = !!env.SAP_OAUTH_CLIENT_ID;
  if (authType !== 'oauth' && !hasOAuthVars) return undefined;

  const missing = ['SAP_OAUTH_TOKEN_URL', 'SAP_OAUTH_CLIENT_ID', 'SAP_OAUTH_CLIENT_SECRET']
    .filter(v => !env[v]);
  if (missing.length > 0) {
    throw new Error(`OAuth mode requires environment variables: ${missing.join(', ')}`);
  }

  return {
    tokenUrl: env.SAP_OAUTH_TOKEN_URL as string,
    clientId: env.SAP_OAUTH_CLIENT_ID as string,
    clientSecret: env.SAP_OAUTH_CLIENT_SECRET as string,
    scope: env.SAP_OAUTH_SCOPE,
  };
}

/**
 * Build a BearerFetcher that returns a valid access token, fetching a new one
 * via client_credentials when the cached token is missing or near expiry.
 */
export type BearerFetcher = (() => Promise<string>) & { invalidate(): void };

export function makeBearerFetcher(cfg: OAuthConfig): BearerFetcher {
  let cachedToken: string | undefined;
  let expiresAt = 0; // epoch ms
  const SKEW_MS = 60_000; // refresh a minute before real expiry
  let inFlight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (cfg.scope) body.set('scope', cfg.scope);

    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OAuth token request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let json: TokenResponse;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`OAuth token endpoint returned non-JSON response: ${text.slice(0, 300)}`);
    }
    if (!json.access_token) {
      throw new Error('OAuth token response did not contain access_token');
    }

    cachedToken = json.access_token;
    const ttlMs = (json.expires_in ?? 3600) * 1000;
    expiresAt = Date.now() + ttlMs;
    return cachedToken;
  }

  const getToken = async function getToken(): Promise<string> {
    if (cachedToken && Date.now() < expiresAt - SKEW_MS) return cachedToken;
    if (!inFlight) {
      inFlight = fetchToken().finally(() => { inFlight = undefined; });
    }
    return inFlight;
  } as BearerFetcher;
  /** Drop the cached token so the next call fetches a fresh one (after a 401 on a token still within expires_in). */
  getToken.invalidate = () => { cachedToken = undefined; expiresAt = 0; };
  return getToken;
}

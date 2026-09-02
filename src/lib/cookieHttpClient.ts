/**
 * Custom HttpClient for abap-adt-api that authenticates via browser-harvested
 * session cookies (SSO / "like Eclipse"), instead of Basic auth or a bearer.
 *
 * The abap-adt-api ADTClient accepts an HttpClient as its first constructor
 * argument. This implementation keeps its own cookie jar: it is seeded with the
 * cookies harvested from an authenticated browser session, injects them on every
 * request, and merges any Set-Cookie the server rotates back (e.g. a refreshed
 * stateful SAP_SESSIONID) so long-running stateful sessions stay valid.
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';

export interface HarvestedCookie {
  name: string;
  value: string;
}

// Structural match for abap-adt-api's HttpClientOptions / HttpClientResponse.
interface HttpClientOptions {
  url: string;
  method?: string;
  headers?: Record<string, any>;
  qs?: Record<string, any>;
  httpsAgent?: https.Agent;
  timeout?: number;
  auth?: { username: string; password: string };
  body?: string;
}
interface HttpClientResponse {
  body: string;
  status: number;
  statusText: string;
  headers: Record<string, any>;
}

export class CookieHttpClient {
  static readonly MAX_RETRY_WAIT_MS = 5000;

  /** Heuristic: a 2xx/3xx HTML document carrying a logon form or SAML/IAS markers. */
  static looksLikeLoginPage(status: number, contentType: unknown, body: string): boolean {
    if (status >= 400) return false;
    const ct = String(contentType || '').toLowerCase();
    const head = body.slice(0, 20000);
    if (!ct.includes('text/html') && !/^\s*<(!doctype html|html)/i.test(head)) return false;
    return /SAMLRequest|SAMLResponse|j_username|sap-idp|accounts\.sap\.com|Identity Authentication|<form[^>]*(logon|login|signin|authenticate)/i.test(head);
  }

  private jar = new Map<string, string>();
  private axiosInstance: AxiosInstance;

  constructor(private baseURL: string, cookies: HarvestedCookie[], allowUnauthorized = false, private sapClient?: string) {
    for (const c of cookies) this.jar.set(c.name, c.value);
    this.axiosInstance = axios.create({
      baseURL,
      // ADT returns XML/text; keep the raw string body the library expects.
      responseType: 'text',
      transformResponse: [(d) => d],
      // Let the library decide what a >=400 status means (it throws itself).
      validateStatus: () => true,
      httpsAgent: allowUnauthorized ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    });
  }

  /** Replace the whole jar (used when re-authenticating after expiry). */
  setCookies(cookies: HarvestedCookie[]): void {
    this.jar.clear();
    for (const c of cookies) this.jar.set(c.name, c.value);
  }

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private mergeSetCookie(setCookie?: string[] | string): void {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of arr) {
      const first = raw.split(';', 1)[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }

  async request(options: HttpClientOptions): Promise<HttpClientResponse> {
    const headers = { ...(options.headers || {}) };
    // Force our jar's cookies onto every request, overriding the library's
    // (empty) jar so the harvested SSO session authenticates the call.
    headers['Cookie'] = this.cookieHeader();

    // Pin every call to the configured client: the harvested SSO cookies alone
    // would land the session in the tenant's default client.
    const params = { ...(options.qs || {}) };
    if (this.sapClient && params['sap-client'] === undefined) params['sap-client'] = this.sapClient;

    const send = () => this.axiosInstance.request({
      url: options.url,
      method: (options.method as any) || 'GET',
      headers,
      params,
      data: options.body,
      timeout: options.timeout,
      httpsAgent: options.httpsAgent,
    });

    let res = await send();

    // Throttled or briefly unavailable: honour Retry-After (capped) and retry once.
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers?.['retry-after']);
      const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, CookieHttpClient.MAX_RETRY_WAIT_MS);
      await new Promise((r) => setTimeout(r, waitMs));
      res = await send();
    }

    this.mergeSetCookie(res.headers?.['set-cookie']);

    // An expired SSO session does not fail: the identity provider answers the
    // redirect chain with its HTML login page and a 200. Surface that as a
    // session-expired error instead of handing HTML to the ADT parser (or,
    // worse, returning it as "source code").
    const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    const isLogoff = /\/icf\/logoff\b/i.test(String(options.url || ''));
    if (!isLogoff && CookieHttpClient.looksLikeLoginPage(res.status, res.headers?.['content-type'], body)) {
      const err: any = new Error('SSO session expired: the identity provider returned a login page instead of an ADT response. Re-authenticate (login) and retry.');
      err.code = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }

    return {
      body,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers as Record<string, any>,
    };
  }
}

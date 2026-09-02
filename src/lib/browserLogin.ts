/**
 * Browser-driven SSO login for S/4HANA Cloud (and any SSO-protected ABAP system),
 * mirroring how Eclipse ADT authenticates: open a real browser, let the user
 * complete SAML2/OIDC SSO, then harvest the resulting session cookies.
 *
 * The session cookie (MYSAPSSO2 / SAP_SESSIONID) is HttpOnly, so it cannot be read
 * from page JavaScript — it is extracted over the Chrome DevTools Protocol
 * (Network.getAllCookies) and fed to the CookieHttpClient. No SAP-side config is
 * required; when the session expires the login is simply run again.
 */

// puppeteer-core is ESM-only. A static import compiles to require(), which
// Node 18/20 refuse for ESM packages and which would break every server start
// (SSO or not). Load it lazily, through a real dynamic import that tsc cannot
// downlevel to require().
type Puppeteer = typeof import('puppeteer-core');
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
let puppeteerModule: Promise<Puppeteer> | undefined;
function loadPuppeteer(): Promise<Puppeteer> {
  if (!puppeteerModule) {
    puppeteerModule = dynamicImport('puppeteer-core').then((m: any) => (m.default ?? m) as Puppeteer);
  }
  return puppeteerModule;
}
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarvestedCookie } from './cookieHttpClient.js';

const CANDIDATE_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

function detectBrowser(): string {
  if (process.env.SAP_BROWSER_PATH) return process.env.SAP_BROWSER_PATH;
  for (const p of CANDIDATE_BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error(
    'No Chrome/Edge/Brave found for SSO login. Set SAP_BROWSER_PATH to a Chromium-based browser executable.'
  );
}

const SESSION_COOKIE_RE = /MYSAPSSO2|SAP_SESSIONID/i;

function belongsToHost(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.replace(/^\./, '');
  return host === d || host.endsWith('.' + d);
}

export interface BrowserLoginOptions {
  timeoutMs?: number;
}

/**
 * Open a browser at the ADT discovery URL, wait for the user to complete SSO, and
 * return the session cookies for the SAP host. Resolves once a session cookie
 * appears; rejects on timeout.
 */
export async function browserLogin(
  sapUrl: string,
  client?: string,
  opts: BrowserLoginOptions = {}
): Promise<HarvestedCookie[]> {
  const host = new URL(sapUrl).host;
  const executablePath = detectBrowser();
  // Profile for the login window. Default: a dedicated persistent profile per
  // host, so "keep me signed in" survives restarts without touching the user's
  // own browser profile. SAP_BROWSER_PROFILE_DIR overrides it with a custom
  // profile directory (e.g. a separate Chrome profile kept for SAP work, with
  // saved passwords/passkeys). The browser's own DEFAULT profile cannot be used:
  // Chrome 136+ refuses DevTools automation on it, it is locked while the
  // browser is open, and the CDP session would expose cookies of every site in
  // it — a dedicated directory keeps the blast radius to SAP/IdP cookies only.
  let userDataDir = process.env.SAP_BROWSER_PROFILE_DIR;
  if (userDataDir) {
    const chromeDefault = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    if (path.resolve(userDataDir) === chromeDefault) {
      throw new Error(
        'SAP_BROWSER_PROFILE_DIR must not point at the browser\'s default profile directory: ' +
        'Chrome blocks automation on it and the login window would expose all its cookies. ' +
        'Use a dedicated profile directory instead.'
      );
    }
    fs.mkdirSync(userDataDir, { recursive: true });
  } else {
    userDataDir = path.join(os.homedir(), '.abap-adt-mcp', 'sso', host);
    fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(userDataDir), 0o700);
    fs.chmodSync(userDataDir, 0o700);
  }

  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    const cdp = await page.target().createCDPSession();
    // The discovery doc downloads once authenticated; suppress the file save.
    await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});

    const base = sapUrl.replace(/\/$/, '');
    const discovery = `${base}/sap/bc/adt/core/discovery${client ? `?sap-client=${client}` : ''}`;
    // Navigation may "fail" when the response is a download — that is expected.
    await page.goto(discovery, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    const deadline = Date.now() + (opts.timeoutMs ?? 300000);
    while (Date.now() < deadline) {
      if (!browser.connected) {
        throw new Error('Browser was closed before the SSO login completed.');
      }
      let cookies: any[];
      try {
        ({ cookies } = (await cdp.send('Network.getAllCookies')) as { cookies: any[] });
      } catch (e) {
        // The user closing the window/tab closes the CDP session mid-poll.
        if (!browser.connected) {
          throw new Error('Browser was closed before the SSO login completed.');
        }
        throw e;
      }
      const forHost = cookies.filter((c) => belongsToHost(c.domain, host));
      if (forHost.some((c) => SESSION_COOKIE_RE.test(c.name))) {
        return forHost.map((c) => ({ name: c.name, value: c.value }));
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(
      `SSO login timed out after ${(opts.timeoutMs ?? 300000) / 1000}s — no session cookie captured for ${host}.`
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

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

// puppeteer-core is ESM-only and, at 37 MB, the largest branch of the install.
// A static import would load it on every server start, SSO or not, and tsc
// would compile it to require(). Load it lazily, through a real dynamic import
// that tsc cannot downlevel, so only an SSO login pays for it.
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

/**
 * Chromium-based browsers to try, in order, where their installers put them.
 * On Windows each browser can sit under Program Files, Program Files (x86)
 * (Edge's default, even on ARM64) or a per-user LOCALAPPDATA install.
 */
export function candidateBrowsers(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    const exes = [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ];
    return exes.flatMap(exe => roots.map(root => path.win32.join(root, ...exe)));
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ];
}

function detectBrowser(): string {
  if (process.env.SAP_BROWSER_PATH) return process.env.SAP_BROWSER_PATH;
  for (const p of candidateBrowsers()) if (fs.existsSync(p)) return p;
  throw new Error(
    'No Chrome/Edge/Brave found for SSO login. Set SAP_BROWSER_PATH to a Chromium-based browser executable.'
  );
}

/**
 * Directory name of the per-host login profile. The host carries the port
 * (`sap.example.com:44300`), and a colon is not allowed in a Windows file
 * name, so there it becomes an underscore. Other platforms keep the host as
 * is, so existing profiles (and their "keep me signed in") stay where they are.
 */
export function profileDirName(host: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? host.replace(/[<>:"/\\|?*]/g, '_') : host;
}

const SESSION_COOKIE_RE = /MYSAPSSO2|SAP_SESSIONID/i;

/** True when a cookie set for `cookieDomain` is sent to `hostname` (no port). */
export function belongsToHost(cookieDomain: string, hostname: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  const h = hostname.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

/**
 * The name cookies are matched against for a SAP URL. Cookie domains never carry
 * a port, so `https://sap.example.com:44300` must match cookies for
 * `sap.example.com`; comparing against `URL.host` (name plus port) made every
 * SSO login on a non-default port time out without a cookie.
 */
export function cookieHostOf(sapUrl: string): string {
  return new URL(sapUrl).hostname;
}

/**
 * The origin to configure instead, when the login ended on another host. A URL
 * such as `http://10.0.0.5:8000` that the ICF redirects to
 * `https://sap.example.com:44300` leaves the session cookie on the redirect
 * target, so the poll below would wait for a cookie of the configured host
 * that never comes. `navigations` are the URLs the login window navigated to
 * (redirects included); the page URL itself is useless here, because once the
 * discovery document is refused as a download the tab shows `about:blank` or
 * an error page. Returns the origin of the first ADT navigation on another
 * host that already holds a session cookie, otherwise undefined. Only ADT
 * paths count, so an identity provider that is itself an ABAP system (and sets
 * its own SAP_SESSIONID) cannot end a SAML login early.
 */
export function redirectedOrigin(
  cookies: { name: string; domain: string }[],
  cookieHost: string,
  navigations: Iterable<string>
): string | undefined {
  for (const nav of navigations) {
    let url: URL;
    try {
      url = new URL(nav);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (!url.pathname.startsWith('/sap/bc/adt/')) continue;
    if (belongsToHost(url.hostname, cookieHost)) continue;
    const hasSession = cookies.some(
      (c) => SESSION_COOKIE_RE.test(c.name) && belongsToHost(c.domain, url.hostname)
    );
    if (hasSession) return url.origin;
  }
  return undefined;
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
  const host = new URL(sapUrl).host; // profile directory name and messages
  const cookieHost = cookieHostOf(sapUrl);
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
    userDataDir = path.join(os.homedir(), '.abap-adt-mcp', 'sso', profileDirName(host));
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
    const cdp = await page.createCDPSession();
    // The discovery doc downloads once authenticated; suppress the file save.
    await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});

    // Every URL the tab navigates to, redirect targets included.
    const navigations = new Set<string>();
    page.on('request', (req: any) => {
      if (req.isNavigationRequest()) navigations.add(req.url());
    });

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
      const forHost = cookies.filter((c) => belongsToHost(c.domain, cookieHost));
      if (forHost.some((c) => SESSION_COOKIE_RE.test(c.name))) {
        return forHost.map((c) => ({ name: c.name, value: c.value }));
      }
      const moved = redirectedOrigin(cookies, cookieHost, navigations);
      if (moved) {
        throw new Error(
          `SSO login landed on ${moved}, not on the configured ${new URL(sapUrl).origin}: the SAP system redirected ` +
            `the login and the session cookie belongs to that host. Set this destination's "url" to ${moved} and log in again.`
        );
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

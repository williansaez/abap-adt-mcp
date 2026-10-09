/**
 * `abap-adt-mcp --check`: the installation questions a host log answers badly,
 * answered on the terminal before any MCP host is involved. Node version,
 * the systems file, whether each destination answers over HTTPS with the
 * configured TLS settings, and a browser for SSO destinations. No credentials
 * are sent: an HTTP 401 from /sap/bc/adt/discovery counts as reachable.
 */
import fs from 'fs';
import https from 'https';
import { readSystems, SystemConfig, NoSystemsConfiguredError } from './systems.js';
import { buildHttpsAgent } from './tls.js';
import { candidateBrowsers } from './browserLogin.js';
import { classifyAdtError } from './adtErrorHints.js';

export type CheckLevel = 'ok' | 'warn' | 'fail';
export interface CheckLine { level: CheckLevel; text: string }

const MIN_NODE: [number, number] = [22, 12];

export function checkNode(version: string = process.versions.node): CheckLine {
  const [major, minor] = version.split('.').map(Number);
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return ok
    ? { level: 'ok', text: `Node.js ${version}` }
    : { level: 'fail', text: `Node.js ${version} is too old: install 22.12 or newer (22 or 24 LTS), then make sure the MCP host starts that one (GUI apps on macOS do not see nvm or Homebrew paths; point "command" at the full path of npx).` };
}

export function checkBrowser(systems: SystemConfig[], env: NodeJS.ProcessEnv = process.env): CheckLine | undefined {
  const sso = systems.filter(s => s.authType === 'sso').map(s => s.name);
  if (!sso.length) return undefined;
  if (env.SAP_BROWSER_PATH) {
    return fs.existsSync(env.SAP_BROWSER_PATH)
      ? { level: 'ok', text: `browser for SSO: ${env.SAP_BROWSER_PATH}` }
      : { level: 'fail', text: `SAP_BROWSER_PATH points at ${env.SAP_BROWSER_PATH}, which does not exist` };
  }
  const found = candidateBrowsers().find(p => fs.existsSync(p));
  return found
    ? { level: 'ok', text: `browser for SSO: ${found}` }
    : { level: 'fail', text: `${sso.join(', ')} use browser SSO but no Chrome, Edge or Brave was found: install one or set SAP_BROWSER_PATH` };
}

/** One unauthenticated GET against the ADT discovery document. Any HTTP status means the host, port and TLS are fine. */
export function probe(sys: SystemConfig, timeoutMs = 10000): Promise<CheckLine> {
  const url = new URL('/sap/bc/adt/discovery', sys.url);
  return new Promise((resolve) => {
    let agent: https.Agent;
    try {
      agent = buildHttpsAgent(sys.tls, sys.insecureTls);
    } catch (e: any) {
      resolve({ level: 'fail', text: `${sys.name}: ${e.message}` });
      return;
    }
    const req = https.get(url, { agent, timeout: timeoutMs }, (res) => {
      res.resume();
      const status = res.statusCode || 0;
      const level: CheckLevel = status === 404 ? 'warn' : 'ok';
      const note = status === 404 ? ' (ADT service not found: activate /sap/bc/adt in SICF)' : '';
      resolve({ level, text: `${sys.name}: ${sys.url} answers HTTP ${status}${note}` });
      agent.destroy();
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`no answer within ${timeoutMs / 1000} s`), { code: 'ETIMEDOUT' })));
    req.on('error', (e: any) => {
      const c = classifyAdtError(e, { destination: sys.name, url: sys.url });
      const hint = c.kind === 'tlsCertificate' ? ` ${c.hint}` : network(e.code);
      resolve({ level: 'fail', text: `${sys.name}: ${sys.url} unreachable (${e.code || e.message}).${hint}` });
      agent.destroy();
    });
  });
}

function network(code: string | undefined): string {
  if (code === 'ENOTFOUND') return ' The host name does not resolve: check the url, or connect the VPN.';
  if (code === 'ECONNREFUSED') return ' Nothing listens on that port: check the port in the url (on-prem HTTPS is often 443nn).';
  if (code === 'ETIMEDOUT') return ' No answer: a firewall or a missing VPN connection is the usual cause.';
  return '';
}

export async function runSelfCheck(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (l) => process.stdout.write(l + '\n'),
): Promise<number> {
  const lines: CheckLine[] = [checkNode()];
  let systems: SystemConfig[] = [];
  try {
    const map = readSystems(env);
    systems = [...map.values()];
    lines.push({ level: 'ok', text: `systems: ${systems.map(s => `${s.name} (${s.authType})`).join(', ')}` });
  } catch (e: any) {
    lines.push({ level: 'fail', text: e instanceof NoSystemsConfiguredError ? e.message : `systems: ${e.message}` });
  }
  const browser = checkBrowser(systems, env);
  if (browser) lines.push(browser);
  lines.push(...await Promise.all(systems.map(s => probe(s))));

  write(`abap-adt-mcp ${version} self-check`);
  const tag: Record<CheckLevel, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  for (const l of lines) write(`${tag[l.level]}  ${l.text}`);
  const failed = lines.some(l => l.level === 'fail');
  write(failed
    ? 'Fix the FAIL lines, run --check again, then restart the MCP server in your host.'
    : 'Ready. Restart the MCP server in your host (/reload-plugins in Claude Code) and ask the agent to list your SAP systems.');
  return failed ? 1 : 0;
}

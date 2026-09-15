/**
 * Adapter for passwordless, headless on-prem authentication.
 *
 * The MCP server deliberately does not link to the SAP NW RFC SDK. A trusted
 * local provider can use SNC to open an RFC connection, request a short-lived
 * logon/assertion ticket and return it as JSON. The ticket is converted into a
 * MYSAPSSO2 cookie and remains in this process' memory only.
 */

import { execFile } from 'child_process';
import { HarvestedCookie } from './cookieHttpClient.js';
import { Sso2ProviderConfig } from './systems.js';

const MAX_PROVIDER_OUTPUT_BYTES = 128 * 1024;
const MAX_TICKET_CHARS = 64 * 1024;

function runProvider(config: Sso2ProviderConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(config.command, config.args, {
      encoding: 'utf8',
      timeout: config.timeoutMs,
      maxBuffer: MAX_PROVIDER_OUTPUT_BYTES,
      windowsHide: true,
      killSignal: 'SIGKILL',
      // Explicitly disable shell interpretation: command and arguments come
      // from trusted local configuration but are never concatenated.
      shell: false,
    }, (error, stdout) => {
      if (error) {
        const code = typeof (error as any).code === 'number' ? `exit ${(error as any).code}`
          : (error as any).killed ? 'timeout'
            : 'execution error';
        // stdout/stderr may contain a live ticket or library diagnostics. Do
        // not attach either one to this error or send them to stderr.
        reject(new Error(`SSO2 ticket provider failed (${code})`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Obtain and validate one MYSAPSSO2 cookie without exposing the ticket. */
export async function getSso2Cookies(config: Sso2ProviderConfig): Promise<HarvestedCookie[]> {
  const stdout = await runProvider(config);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error('SSO2 ticket provider returned invalid JSON (expected {"ticket":"..."})');
  }
  const ticket = (parsed as any)?.ticket;
  if (typeof ticket !== 'string' || ticket.length === 0) {
    throw new Error('SSO2 ticket provider returned no ticket');
  }
  if (ticket.length > MAX_TICKET_CHARS) {
    throw new Error('SSO2 ticket provider returned an oversized ticket');
  }
  // A cookie value cannot contain a delimiter or control characters. Reject
  // instead of normalizing, because rewriting a signed ticket invalidates it.
  // RFC 6265 cookie-octet: printable US-ASCII excluding whitespace, quotes,
  // comma, semicolon and backslash. Base64 and percent-encoded SAP tickets fit.
  if (!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(ticket)) {
    throw new Error('SSO2 ticket provider returned an invalid cookie value');
  }
  return [{ name: 'MYSAPSSO2', value: ticket }];
}

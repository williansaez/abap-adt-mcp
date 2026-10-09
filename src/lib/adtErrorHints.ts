/**
 * Classify an ADT/HTTP failure into an actionable kind with a hint for the
 * model and the tools it should call next. Works on the error object when
 * available and falls back to the formatted message text (handlers wrap the
 * original error into an McpError whose message carries the SAP detail).
 */

export type AdtErrorKind =
  | 'policyDenied' | 'tlsCertificate' | 'network' | 'sessionExpired' | 'csrf' | 'locked' | 'staleLockHandle' | 'transportRequired'
  | 'authorization' | 'notFound' | 'rateLimited' | 'wrongInputData' | 'ambiguous400' | 'serverError'
  | 'rfcSdkMissing' | 'rfcSessionLost' | 'unknown';

export interface AdtErrorClassification {
  kind: AdtErrorKind;
  status?: number;
  hint?: string;
  nextTools?: string[];
}

/** Where the failing call was going; lets a hint name the destination and fill in its host and port. */
export interface AdtErrorContext {
  destination?: string;
  url?: string;
  /** "rfc" when the destination uses the RFC transport; the RFC text rules apply only then. */
  transport?: 'http' | 'rfc';
}

const HINTS: Record<Exclude<AdtErrorKind, 'unknown' | 'tlsCertificate' | 'network'>, { hint: string; nextTools: string[] }> = {
  policyDenied: {
    hint: 'The server policy for this destination refuses the call. Retrying will not help: pick another destination (listSystems shows each policy) or ask the owner to change the policy in systems.json.',
    nextTools: ['listSystems'],
  },
  sessionExpired: {
    hint: 'The SAP session expired or was never established. The server re-authenticates and retries once automatically; if this error still surfaces, call login for the destination and lock the object again before writing.',
    nextTools: ['login', 'lock'],
  },
  csrf: {
    hint: 'CSRF token rejected: the session was reset. Re-authenticate (login) and re-acquire any lockHandle before retrying writes.',
    nextTools: ['login', 'lock'],
  },
  locked: {
    hint: 'The object is locked. listLocks shows the locks this server holds: if the object is there, unLock/forceUnlock and retry. If it is not there, the lock belongs to another session (Eclipse/ADT of the same or another user, named in the message); dropSession and forceUnlock cannot release it: wait for that session to end or ask the user to release it (SM12).',
    nextTools: ['unLock', 'lock'],
  },
  staleLockHandle: {
    hint: 'The lockHandle is no longer valid (the session changed, the object was unlocked, or the handle belongs to another object). Call lock again on the object URL and pass the new lockHandle.',
    nextTools: ['lock'],
  },
  transportRequired: {
    hint: 'A transport request is required, or the object is already recorded in a different one. Call resolveTransport for the object and pass the returned transport.',
    nextTools: ['resolveTransport', 'createTransport'],
  },
  authorization: {
    hint: 'The SAP user lacks authorization for this action. Check SU53 for the user, or use a destination whose user has a development role. Retrying will not help.',
    nextTools: ['listSystems'],
  },
  notFound: {
    hint: 'Object or endpoint not found. Resolve the URL with searchObject / findObjectPath (sources need /source/main). On S/4HANA Cloud some ADT endpoints do not exist: check systemProfile for the destination.',
    nextTools: ['searchObject', 'findObjectPath', 'systemProfile'],
  },
  rateLimited: {
    hint: 'SAP throttled the request (429/503). The server already retried once; wait a few seconds before calling again.',
    nextTools: [],
  },
  wrongInputData: {
    hint: 'SAP answered "wrong input data for processing" (ExceptionResourceWrongData). Seen on an object created earlier in this same session and read before its source was written: write the source with setObjectSource (every read works afterwards), or call dropSession and read again. If the object was not just created, the request itself is wrong: an object URL (not a name), /source/main for source tools, and an object that exists (searchObject).',
    nextTools: ['setObjectSource', 'dropSession', 'searchObject'],
  },
  ambiguous400: {
    hint: 'SAP rejected the request as invalid (400). Do not retry login. Check the parameters: ADT object URLs (not names), /source/main for source tools, a lockHandle from lock, JSON where the schema asks for it.',
    nextTools: ['searchObject'],
  },
  serverError: {
    hint: 'SAP-side failure (5xx), often a short dump. Check dumps for the root cause before retrying; do not blindly retry writes.',
    nextTools: ['dumps'],
  },
  rfcSdkMissing: {
    hint: 'This destination uses transport "rfc", which needs the SAP NetWeaver RFC SDK on this machine, and it could not be loaded. Download the NW RFC SDK 7.50 (latest patch level) from the SAP Software Download Center (https://me.sap.com/softwarecenter/search/SAP%20NW%20RFC%20SDK%207.50) with your own S-user, unpack it, and point SAPNWRFC_HOME (or rfc.sdkPath in systems.json) at the folder that contains lib/, then call again (restart the server if SAPNWRFC_HOME changed). It is never bundled with this package because SAP\'s connector licence forbids redistribution. The error text names the library it looked for; docs/RFC.md walks through download, install and configuration. Retrying will not help until the SDK is in place.',
    nextTools: ['listSystems'],
  },
  rfcSessionLost: {
    hint: 'The RFC connection to the system ended (network or gateway cut, timeout, system restart). The server reconnects on the next call, but in a new ABAP session: locks held in the RFC session are gone. Call lock again before writing (listLocks shows what the server still holds). If the failed call was a write, read the object before repeating it.',
    nextTools: ['lock', 'listLocks'],
  },
};

/**
 * Node's certificate errors, by code and by the message text that survives when
 * a handler rethrows only the formatted string. Three questions, three answers:
 * who signed it (tls.ca), is it for this name (tls.servername), is it still
 * valid (nobody on the client side). insecureTls comes last and is named for
 * what it is.
 */
const TLS_ISSUER_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT', 'CERT_UNTRUSTED']);
const TLS_ISSUER_TEXT = /unable to verify the first certificate|self[- ]signed certificate|unable to get (local )?issuer certificate|certificate is not trusted/i;
const TLS_NAME_TEXT = /Hostname\/IP does not match certificate's altnames/i;
const TLS_EXPIRED_TEXT = /certificate has expired/i;

type TlsFailure = 'issuer' | 'name' | 'expired';

function detectTlsFailure(code: string | undefined, text: string): TlsFailure | undefined {
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || TLS_NAME_TEXT.test(text)) return 'name';
  if (code === 'CERT_HAS_EXPIRED' || TLS_EXPIRED_TEXT.test(text)) return 'expired';
  if ((code && TLS_ISSUER_CODES.has(code)) || TLS_ISSUER_TEXT.test(text)) return 'issuer';
  return undefined;
}

function hostPort(url: string | undefined): { host: string; port: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || (u.protocol === 'http:' ? '80' : '443') };
  } catch {
    return undefined;
  }
}

function tlsHint(failure: TlsFailure, text: string, ctx: AdtErrorContext | undefined): string {
  const dest = ctx?.destination ? `destination ${ctx.destination}` : 'the destination';
  const hp = hostPort(ctx?.url);
  const where = hp ? `${hp.host}:${hp.port}` : '<host>:<port>';
  const host = hp?.host ?? '<host>';
  const escape = 'insecureTls: true turns verification off for that destination; acceptable on a throwaway sandbox, not on a system that holds real data.';
  if (failure === 'name') {
    const detail = text.match(/altnames:\s*(.+?)(?:\s*\||$)/i)?.[1]?.trim();
    return `The certificate of ${dest} is not issued for the host in its url${detail ? ` (${detail})` : ''}. ` +
      'Verification is otherwise fine: set "tls": { "servername": "<the DNS name the certificate carries>" } on that destination in systems.json, so a system reached by IP address or short hostname is checked against the name on its certificate. ' +
      `If the issuer is also unknown, add tls.ca as well (docs/CONFIGURATION.md, "tls.servername"). ${escape}`;
  }
  if (failure === 'expired') {
    return `The certificate presented by ${dest} (${where}) has expired. No client-side setting fixes this: the SAP system's certificate has to be renewed (STRUST, SSL server PSE). ` +
      `Until then ${escape.charAt(0).toLowerCase()}${escape.slice(1)}`;
  }
  return `${dest.charAt(0).toUpperCase()}${dest.slice(1)} (${where}) presented a certificate whose issuer this server does not trust: a corporate CA or a self-signed certificate. ` +
    `Export the chain and hand it to tls.ca: openssl s_client -connect ${where} -servername ${host} -showcerts </dev/null 2>/dev/null | openssl x509 -outform PEM > ~/.abap-adt-mcp/${host}.pem ; ` +
    `then "tls": { "ca": "~/.abap-adt-mcp/${host}.pem" } on that destination in systems.json (docs/CONFIGURATION.md, "tls.ca"; a self-signed certificate is its own CA). ${escape}`;
}

/**
 * Connection failures: the request never got an answer, so there is no HTTP
 * status. By code where the error still carries one, by text where a wrapper
 * kept only the message.
 */
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'EPIPE', 'ERR_NETWORK']);
const NETWORK_TEXT = /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|EPIPE)\b|socket hang up|timeout of \d+ ?ms exceeded/;

function isNetworkFailure(err: any, text: string): boolean {
  const codes = [err?.code, err?.parent?.code, err?.cause?.code];
  return codes.some(c => typeof c === 'string' && NETWORK_CODES.has(c)) || NETWORK_TEXT.test(text);
}

/**
 * Failures of the RFC transport (lib/rfc): the SDK binding could not be
 * loaded, the RFC session ended, or the gateway was not reached. By the
 * RfcError the transport attaches (parent or cause), else by its message text.
 */
type RfcFailure = 'sdk' | 'koffi' | 'sessionLost' | 'workLost' | 'unreachable' | 'logonRefused';

function rfcErrorIn(err: any): { rfcCode: number; rfcCodeName: string } | undefined {
  const candidates = [err, err?.parent, err?.cause, err?.parent?.parent, err?.parent?.cause];
  return candidates.find(c => c && typeof c === 'object' && typeof c.rfcCode === 'number' && typeof c.rfcCodeName === 'string');
}

function detectRfcFailure(err: any, text: string): RfcFailure | undefined {
  const rfc = rfcErrorIn(err);
  const code = [err?.code, err?.parent?.code, rfc?.rfcCodeName].find(c => typeof c === 'string');
  if (code === 'KOFFI_MISSING' || /needs the optional dependency koffi|koffi module does not expose/i.test(text)) return 'koffi';
  if (code === 'SDK_NOT_FOUND' || code === 'SDK_LOAD_FAILED'
    || /\bSDK_NOT_FOUND\b|\bSDK_LOAD_FAILED\b|NetWeaver RFC SDK (?:not found|found at .* could not be loaded|could not be loaded)|SAPNWRFC_HOME/i.test(text)) return 'sdk';
  if (/\bRFC logon to \S+ was refused\b/i.test(text)) return 'logonRefused';
  // An ABAP message or a short dump is SAP's own error: classify it by status
  // and text like any SAP error (a dump points at dumps), even when it also
  // ended the session that held the locks; the message says so.
  if (rfc?.rfcCode === 3 || rfc?.rfcCode === 4 || /\bRFC_ABAP_(?:RUNTIME_FAILURE|MESSAGE)\b/.test(text)) return undefined;
  if (/locks held in the RFC session are gone/i.test(text)) return 'sessionLost';
  if (/\bRFC connection to \S+ lost\b/i.test(text)) return 'workLost';
  if (/\bRFC connection to \S+ could not be opened\b/i.test(text) && (code === 'RFC_COMMUNICATION_FAILURE' || /COMMUNICATION_FAILURE|not reached|gateway|connection refused|timed? ?out/i.test(text))) return 'unreachable';
  return undefined;
}

const RFC_KOFFI_HINT = 'This destination uses transport "rfc", which loads the SAP NetWeaver RFC SDK through the optional dependency koffi, and koffi is not installed: npm skipped optional dependencies. '
  + 'Check npm config get omit (a company .npmrc often sets omit=optional), remove that setting, delete the npx cache and restart the host, so the package is installed again. The SDK itself is not the problem. Retrying will not help until then.';

const RFC_LOGON_REFUSED_HINT = 'SAP refused the RFC logon: wrong user or password, a locked user, or the system requires SNC for RFC. '
  + 'The server makes no further password logon for this destination until login is called or the server restarts, so failed attempts cannot add up to a locked SAP user. '
  + 'Do not call this destination again until the password is fixed: correct it in systems.json or its environment variable and restart the host (SU01 shows whether the user is locked).';

const RFC_WORK_LOST_HINT = 'The RFC connection that carries the requests (not the one holding the locks) was dropped; the server reconnects on the next call and the locks are still held. '
  + 'If the failed call was a write, read the object (getObjectSource, inactiveObjects) before repeating it.';

function rfcNetworkHint(ctx: AdtErrorContext | undefined): string {
  const where = ctx?.destination ? `destination ${ctx.destination}` : 'the SAP system';
  return `The RFC connection to ${where} could not be opened: the SAP gateway was not reached. This is not an ABAP error. ` +
    'Check rfc.ashost and rfc.sysnr in systems.json (the gateway listens on port 33<sysnr>, e.g. 3300) or rfc.mshost, rfc.sysid and rfc.group for a message server logon, rfc.saprouter when the system sits behind a SAProuter, and that VPN and firewall let this machine reach that port.';
}

function networkHint(ctx: AdtErrorContext | undefined): string {
  const hp = hostPort(ctx?.url);
  const where = ctx?.destination ? `destination ${ctx.destination}${hp ? ` (${hp.host}:${hp.port})` : ''}` : 'the SAP system';
  return `${where.charAt(0).toUpperCase()}${where.slice(1)} did not answer: the connection failed or timed out (host name not resolved, VPN or proxy down, system stopped, connection cut). ` +
    'This is not an ABAP error and there is no HTTP status. Check that the system is reachable from this machine and that url in systems.json is right, then call again. ' +
    'If the failed call was a write, it may or may not have reached SAP: read the object (getObjectSource, inactiveObjects, listLocks) before repeating it.';
}

/**
 * abap-adt-api wraps every error it does not recognise (a connection failure,
 * an error thrown by the cookie client, a TypeError of its own parser) as an
 * AdtErrorException with err 500. That 500 was never sent by SAP. A 500 that
 * SAP did send carries the exception namespace, the response, or the
 * "Error 500:" text of an empty body.
 */
function isSynthetic500(err: any): boolean {
  if (Number(err?.err) !== 500) return false;
  if (err.type === 'Unknown error') return true;
  return err.type === '' && !err.namespace && !err.response && !/^Error 500:/.test(String(err.message || ''));
}

function extractStatus(err: any, text: string): number | undefined {
  const candidates = [err?.status, isSynthetic500(err) ? undefined : err?.err, err?.response?.status, err?.parent?.status, err?.parent?.response?.status];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  const m = text.match(/status code (\d{3})|\bError (\d{3}):|\bHTTP (\d{3})\b/i);
  if (m) return parseInt(m[1] || m[2] || m[3], 10);
  return undefined;
}

export function classifyAdtError(input: unknown, context?: AdtErrorContext): AdtErrorClassification {
  const err: any = input && typeof input === 'object' ? input : {};
  // Handlers rethrow SAP errors as McpError("<what failed>: <message>") with the
  // original attached as `cause`. Classify that original: it still carries the
  // HTTP status and error code the wrapper text may have lost.
  if (err.cause && typeof err.cause === 'object' && err.cause !== err) {
    return classifyAdtError(err.cause, context);
  }
  const text = [
    typeof input === 'string' ? input : '',
    err.message, err.localizedMessage, err.type, err.namespace,
    err.properties && typeof err.properties === 'object' ? Object.entries(err.properties).map(([k, v]) => `${k}: ${v}`).join(' ') : '',
    err.parent?.message,
  ].filter(Boolean).join(' | ');
  const status = extractStatus(err, text);
  const lower = text.toLowerCase();
  const has = (re: RegExp) => re.test(text);

  // RFC transport failures carry no HTTP status of their own (a logon failure
  // carries 401 and is handled below as an expired session).
  // RFC transport failures. Their text rules apply only to destinations that use
  // the RFC transport, or to an error that still carries the RFC error object,
  // so an HTTP error whose SAP text merely mentions RFC is never reclassified.
  const rfcScope = context?.transport === 'rfc' || !!rfcErrorIn(err);
  const rfcFailure = rfcScope ? detectRfcFailure(err, text) : undefined;
  if (rfcFailure === 'sdk') return { kind: 'rfcSdkMissing', status: undefined, ...HINTS.rfcSdkMissing };
  if (rfcFailure === 'koffi') return { kind: 'rfcSdkMissing', status: undefined, hint: RFC_KOFFI_HINT, nextTools: ['listSystems'] };
  if (rfcFailure === 'logonRefused') return { kind: 'authorization', status: undefined, hint: RFC_LOGON_REFUSED_HINT, nextTools: ['listSystems'] };
  if (rfcFailure === 'sessionLost') return { kind: 'rfcSessionLost', status: undefined, ...HINTS.rfcSessionLost };
  if (rfcFailure === 'workLost') return { kind: 'network', status: undefined, hint: RFC_WORK_LOST_HINT, nextTools: ['getObjectSource', 'inactiveObjects'] };
  if (rfcFailure === 'unreachable') return { kind: 'network', status: undefined, hint: rfcNetworkHint(context), nextTools: ['listSystems'] };

  // Before anything status-based: a handshake failure never has an HTTP status,
  // and the code may sit on the error or on the axios error it wraps.
  const tlsFailure = detectTlsFailure(err.code ?? err.parent?.code ?? err.cause?.code, text);
  if (tlsFailure) {
    return { kind: 'tlsCertificate', status: undefined, hint: tlsHint(tlsFailure, text, context), nextTools: ['listSystems'] };
  }

  if (isNetworkFailure(err, text)) {
    return { kind: 'network', status: undefined, hint: networkHint(context), nextTools: ['listSystems', 'listLocks'] };
  }

  let kind: AdtErrorKind = 'unknown';
  if (err.code === 'POLICY_DENIED' || /^(?:MCP error -?\d+: )?Policy:/i.test(text) || has(/blocked by the destination policy/i)) {
    kind = 'policyDenied';
  } else if (err.code === 'SESSION_EXPIRED' || status === 401 || has(/session (timed out|expired)|login page|identity provider|\bSAMLRequest\b|\bsaml (login|response|assertion|authentication)\b|logon ticket (expired|invalid|missing)/i) || (rfcScope && has(/\bRFC logon to \S+ failed\b/i))) {
    kind = 'sessionExpired';
  } else if (has(/csrf/i) && (status === 403 || has(/token/i))) {
    kind = 'csrf';
  } else if (status === 412 || status === 423 || has(/invalid lock handle|lock handle (is )?(invalid|expired|not valid)|\blockhandle\b.*(invalid|expired|not valid|stale)|(invalid|expired|stale) lockhandle/i)) {
    kind = 'staleLockHandle';
  } else if (has(/ExceptionResourceNoAccess|locked by|is being edited by|currently being processed by|enqueue|sm12|already locked/i) || err.properties?.ideUser) {
    kind = 'locked';
  } else if (status === 409 || has(/transport request|not assigned to a (transport|request)|request\/task|recording of changes|is not modifiable|already in (a|another) (transport|request)/i)) {
    kind = 'transportRequired';
  } else if (err.type === 'ExceptionResourceWrongData' || has(/ExceptionResourceWrongData|wrong input data for processing/i)) {
    kind = 'wrongInputData';
  } else if (status === 403 || has(/not authorized|no authorization|missing authorization|authorization check|su53/i) || (rfcScope && has(/no RFC authori[sz]ation/i))) {
    kind = 'authorization';
  } else if (status === 404 || has(/not found|does not exist|could not be found|resource .* unknown/i)) {
    kind = 'notFound';
  } else if (status === 429 || status === 503) {
    kind = 'rateLimited';
  } else if (status === 400) {
    kind = 'ambiguous400';
  } else if (status !== undefined && status >= 500) {
    kind = 'serverError';
  }
  void lower;

  if (kind === 'unknown') return { kind, status };
  return { kind, status, ...HINTS[kind as Exclude<AdtErrorKind, 'unknown' | 'tlsCertificate' | 'network'>] };
}

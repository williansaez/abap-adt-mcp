/**
 * Classify an ADT/HTTP failure into an actionable kind with a hint for the
 * model and the tools it should call next. Works on the error object when
 * available and falls back to the formatted message text (handlers wrap the
 * original error into an McpError whose message carries the SAP detail).
 */

export type AdtErrorKind =
  | 'sessionExpired' | 'csrf' | 'locked' | 'staleLockHandle' | 'transportRequired'
  | 'authorization' | 'notFound' | 'rateLimited' | 'ambiguous400' | 'serverError' | 'unknown';

export interface AdtErrorClassification {
  kind: AdtErrorKind;
  status?: number;
  hint?: string;
  nextTools?: string[];
}

const HINTS: Record<Exclude<AdtErrorKind, 'unknown'>, { hint: string; nextTools: string[] }> = {
  sessionExpired: {
    hint: 'The SAP session expired or was never established. The server re-authenticates and retries once automatically; if this error still surfaces, call login for the destination and lock the object again before writing.',
    nextTools: ['login', 'lock'],
  },
  csrf: {
    hint: 'CSRF token rejected: the session was reset. Re-authenticate (login) and re-acquire any lockHandle before retrying writes.',
    nextTools: ['login', 'lock'],
  },
  locked: {
    hint: 'The object is locked. If the lock is yours from an earlier call, run unLock (or dropSession) and lock again; if it belongs to another user, do not retry the write: wait for them or ask them to release it (SM12).',
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
  ambiguous400: {
    hint: 'SAP rejected the request as invalid (400). Do not retry login. Check the parameters: ADT object URLs (not names), /source/main for source tools, a lockHandle from lock, JSON where the schema asks for it.',
    nextTools: ['searchObject'],
  },
  serverError: {
    hint: 'SAP-side failure (5xx), often a short dump. Check dumps for the root cause before retrying; do not blindly retry writes.',
    nextTools: ['dumps'],
  },
};

function extractStatus(err: any, text: string): number | undefined {
  const candidates = [err?.status, err?.err, err?.response?.status, err?.parent?.status, err?.parent?.response?.status];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  const m = text.match(/status code (\d{3})|\bError (\d{3}):|\bHTTP (\d{3})\b/i);
  if (m) return parseInt(m[1] || m[2] || m[3], 10);
  return undefined;
}

export function classifyAdtError(input: unknown): AdtErrorClassification {
  const err: any = input && typeof input === 'object' ? input : {};
  const text = [
    typeof input === 'string' ? input : '',
    err.message, err.localizedMessage, err.type, err.namespace,
    err.properties && typeof err.properties === 'object' ? Object.entries(err.properties).map(([k, v]) => `${k}: ${v}`).join(' ') : '',
    err.parent?.message,
  ].filter(Boolean).join(' | ');
  const status = extractStatus(err, text);
  const lower = text.toLowerCase();
  const has = (re: RegExp) => re.test(text);

  let kind: AdtErrorKind = 'unknown';
  if (err.code === 'SESSION_EXPIRED' || status === 401 || has(/session (timed out|expired)|login page|identity provider|saml|logon ticket/i)) {
    kind = 'sessionExpired';
  } else if (has(/csrf/i) && (status === 403 || has(/token/i))) {
    kind = 'csrf';
  } else if (status === 412 || status === 423 || has(/invalid lock handle|lock handle (is )?(invalid|expired|not valid)|lockhandle/i)) {
    kind = 'staleLockHandle';
  } else if (has(/ExceptionResourceNoAccess|locked by|is being edited by|currently being processed by|enqueue|sm12|already locked/i) || err.properties?.ideUser) {
    kind = 'locked';
  } else if (status === 409 || has(/transport request|not assigned to a (transport|request)|request\/task|recording of changes|is not modifiable|already in (a|another) (transport|request)/i)) {
    kind = 'transportRequired';
  } else if (status === 403 || has(/not authorized|no authorization|missing authorization|authorization check|su53/i)) {
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
  return { kind, status, ...HINTS[kind] };
}

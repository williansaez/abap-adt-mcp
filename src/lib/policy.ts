/**
 * Per-destination security policy, enforced by the server before a tool call
 * reaches SAP, independently of what the MCP host approves.
 *
 * Configured in systems.json under each destination:
 *   "policy": {
 *     "readOnly": true,                       // only read-only tools (plus login/logout/dropSession)
 *     "deniedTools": ["transportRelease", "git*"],
 *     "allowFreeSql": false,                  // blocks runQuery and tableContents with sqlQuery
 *     "deniedTables": ["PA*", "HR*", "USR02"],
 *     "allowedPackages": ["Z*", "$*"],        // writes only inside these packages (closed mode)
 *     "allowedTransports": ["DEVK9*"]         // writes/releases only with these transports; no new ones
 *   }
 * MCP_READ_ONLY=1 in the environment makes every destination readOnly.
 */

import { READ_ONLY_TOOLS } from '../toolManifest.js';

export interface SystemPolicy {
  readOnly?: boolean;
  deniedTools?: string[];
  allowFreeSql?: boolean;
  deniedTables?: string[];
  allowedPackages?: string[];
  allowedTransports?: string[];
}

export type PolicyGate = 'readOnly' | 'deniedTools' | 'allowFreeSql' | 'deniedTables' | 'allowedPackages' | 'allowedTransports';

export interface PolicyDecision {
  allowed: boolean;
  gate?: PolicyGate;
  reason?: string;
}

/** Tools that never mutate SAP state and stay usable on a read-only destination. */
const ALWAYS_ALLOWED = new Set(['login', 'logout', 'dropSession', 'listSystems', 'healthcheck', 'systemProfile']);

/** Tools whose target object (by URL) decides the package for allowedPackages. */
const OBJECT_URL_ARGS: Record<string, string> = {
  setObjectSource: 'objectSourceUrl',
  editObjectSource: 'objectSourceUrl',
  atcApplyQuickfix: 'objectSourceUrl',
  deleteObject: 'objectUrl',
  lock: 'objectUrl',
  activateByName: 'objectUrl',
  setDomainProperties: 'domainUrl',
  setDataElementProperties: 'dataElementUrl',
  setTextElements: 'objectUrl',
  changePackagePreview: 'objectUrl',
};

/** Tools that take a transport request as argument. */
const TRANSPORT_ARGS: Record<string, string> = {
  setObjectSource: 'transport', editObjectSource: 'transport', createObject: 'transport', deleteObject: 'transport',
  atcApplyQuickfix: 'transport', gitPullRepo: 'transport', gitCreateRepo: 'transport', rapGenGenerate: 'transport',
  createTestInclude: 'transport', setDomainProperties: 'transport', setDataElementProperties: 'transport',
  setTextElements: 'transport', changePackagePreview: 'transport',
  transportRelease: 'transportNumber', transportDelete: 'transportNumber', transportSetOwner: 'transportNumber',
  transportAddUser: 'transportNumber',
};

export function parsePolicy(raw: any): SystemPolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const list = (v: any): string[] | undefined => Array.isArray(v) ? v.map(String).filter(Boolean) : (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);
  const bool = (v: any): boolean | undefined => v === undefined ? undefined : (v === true || /^(1|true|yes)$/i.test(String(v)));
  const p: SystemPolicy = {
    readOnly: bool(raw.readOnly),
    deniedTools: list(raw.deniedTools),
    allowFreeSql: bool(raw.allowFreeSql),
    deniedTables: list(raw.deniedTables),
    allowedPackages: list(raw.allowedPackages),
    allowedTransports: list(raw.allowedTransports),
  };
  return Object.values(p).some(v => v !== undefined) ? p : undefined;
}

/** Case-insensitive glob: * matches any run, ? one char. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return re.test(value);
}
const matchesAny = (patterns: string[] | undefined, value: string) => !!patterns && patterns.some(p => globMatch(p, value));

/** Object URL (without /source/main, includes, fragments) from any object-ish URL. */
export function objectUrlOf(url: string): string {
  return String(url || '')
    .replace(/[#?].*$/, '')
    .replace(/\/(source\/main|includes\/[^/]+|source\/[^/]+)$/i, '')
    .replace(/\/$/, '');
}

/** Table names referenced by a SELECT (FROM / JOIN targets, joins with aliases). */
export function tablesInSql(sql: string): string[] {
  const names = new Set<string>();
  const re = /\b(?:from|join)\s+([A-Za-z_/][\w/]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(sql || '')))) names.add(m[1].toUpperCase());
  return [...names];
}

export interface PolicyContext {
  /** Resolve the package (DEVCLASS) of an existing object; undefined when unknown. */
  resolvePackage: (objectUrl: string) => Promise<string | undefined>;
}

export function summarizePolicy(policy: SystemPolicy | undefined): Record<string, unknown> | undefined {
  if (!policy) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(policy)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Decide whether `toolName(args)` may run on a destination with `policy`.
 * Gates run in order: readOnly, deniedTools, allowFreeSql, deniedTables,
 * allowedPackages (closed: unknown package => denied), allowedTransports.
 */
export async function evaluatePolicy(
  policy: SystemPolicy | undefined, toolName: string, args: any, ctx: PolicyContext
): Promise<PolicyDecision> {
  if (!policy) return { allowed: true };
  const a = args || {};
  const deny = (gate: PolicyGate, reason: string): PolicyDecision => ({ allowed: false, gate, reason });

  if (policy.readOnly && !READ_ONLY_TOOLS.has(toolName) && !ALWAYS_ALLOWED.has(toolName)) {
    return deny('readOnly', `${toolName} is a write tool and the destination is readOnly`);
  }
  if (matchesAny(policy.deniedTools, toolName)) {
    return deny('deniedTools', `${toolName} is listed in deniedTools`);
  }
  if (policy.allowFreeSql === false) {
    if (toolName === 'runQuery') return deny('allowFreeSql', 'free SQL (runQuery) is disabled; use tableContents on an allowed table');
    if (toolName === 'tableContents' && a.sqlQuery) return deny('allowFreeSql', 'tableContents with sqlQuery counts as free SQL, which is disabled');
  }
  if (policy.deniedTables?.length) {
    const tables: string[] = [];
    if (toolName === 'tableContents' && a.ddicEntityName) tables.push(String(a.ddicEntityName).toUpperCase());
    if (a.sqlQuery) tables.push(...tablesInSql(String(a.sqlQuery)));
    const hit = tables.find(t => matchesAny(policy.deniedTables, t));
    if (hit) return deny('deniedTables', `table ${hit} is in deniedTables`);
  }
  if (policy.allowedPackages?.length) {
    let pkg: string | undefined;
    let where = '';
    if (toolName === 'createObject') { pkg = a.parentName; where = 'parentName'; }
    else if (toolName === 'gitCreateRepo') { pkg = a.packageName; where = 'packageName'; }
    else if (toolName === 'createTestInclude' && a.clas) {
      pkg = await ctx.resolvePackage(`/sap/bc/adt/oo/classes/${encodeURIComponent(String(a.clas).toLowerCase())}`); where = 'class package';
    } else if (OBJECT_URL_ARGS[toolName] && a[OBJECT_URL_ARGS[toolName]]) {
      pkg = await ctx.resolvePackage(objectUrlOf(String(a[OBJECT_URL_ARGS[toolName]]))); where = 'object package';
    } else if (toolName === 'changePackageExecute' || toolName === 'changePackagePreview') {
      const target = a.newPackage || (typeof a.refactoring === 'string' ? (() => { try { return JSON.parse(a.refactoring).newPackage; } catch { return undefined; } })() : a.refactoring?.newPackage);
      if (target && !matchesAny(policy.allowedPackages, String(target))) return deny('allowedPackages', `target package ${target} is not in allowedPackages`);
    }
    if (where) {
      if (!pkg) return deny('allowedPackages', `could not determine the ${where} of the object, and allowedPackages is closed`);
      if (!matchesAny(policy.allowedPackages, String(pkg))) return deny('allowedPackages', `package ${String(pkg).toUpperCase()} is not in allowedPackages (${policy.allowedPackages.join(', ')})`);
    }
  }
  if (policy.allowedTransports?.length) {
    if (toolName === 'createTransport' || (toolName === 'resolveTransport' && a.createIfMissing === true)) {
      return deny('allowedTransports', 'creating transports is not allowed when allowedTransports is set; use one of the listed transports');
    }
    const argName = TRANSPORT_ARGS[toolName];
    const tr = argName ? a[argName] : undefined;
    if (tr && !matchesAny(policy.allowedTransports, String(tr))) {
      return deny('allowedTransports', `transport ${String(tr).toUpperCase()} is not in allowedTransports (${policy.allowedTransports.join(', ')})`);
    }
  }
  return { allowed: true };
}

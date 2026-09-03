/**
 * ABAP Cloud / Clean Core release state of SAP objects.
 *
 * Source of truth: SAP's public cloudification repository
 * (github.com/SAP/abap-atc-cr-cv-s4hc), the same JSON the ATC "cloud
 * readiness" checks consume. Fetched once per edition, cached in memory and
 * on disk (~/.abap-adt-mcp/cache) for 24 hours.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export type ReleaseEdition = 'cloud' | 'btp' | 'pce2023' | 'pce2022';

const FILES: Record<ReleaseEdition, string> = {
  cloud: 'objectReleaseInfoLatest.json',
  btp: 'objectReleaseInfo_BTPLatest.json',
  pce2023: 'objectReleaseInfo_PCE2023_2.json',
  pce2022: 'objectReleaseInfo_PCE2022_2.json',
};
const CLASSIFICATIONS = 'objectClassifications_SAP.json';
const BASE = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface ReleaseEntry {
  tadirObject: string;
  tadirObjName: string;
  objectType?: string;
  objectKey?: string;
  softwareComponent?: string;
  applicationComponent?: string;
  state: string;
  successorClassification?: string;
  successors?: Array<{ tadirObject: string; tadirObjName: string; objectType?: string; objectKey?: string }>;
}

export interface ReleaseIndex {
  edition: ReleaseEdition;
  byName: Map<string, ReleaseEntry[]>;         // NAME -> entries (any type)
  classificationByName: Map<string, ReleaseEntry[]>;
  loadedAt: string;
  counts: { released: number; classifications: number };
}

export interface ReleaseVerdict {
  name: string;
  type?: string;
  /** released | deprecated | classicAPI | noAPI | unknown (not in the repository) | customer */
  state: string;
  cloudReady: boolean;
  successors: Array<{ name: string; type: string }>;
  softwareComponent?: string;
  applicationComponent?: string;
  note?: string;
}

export type Loader = (url: string) => Promise<string>;

const memory = new Map<string, { index: ReleaseIndex; at: number }>();

/** Disk cache directory: MCP_CACHE_DIR when set (tests point it at a temp dir), else ~/.abap-adt-mcp/cache. */
function cacheFile(name: string): string {
  return path.join(process.env.MCP_CACHE_DIR || path.join(os.homedir(), '.abap-adt-mcp', 'cache'), name);
}

const FETCH_TIMEOUT_MS = 15_000;
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return res.text();
}

/** Read a repository file from disk cache (fresh) or the network, updating the cache; a stale cache beats a failed download. */
async function loadFile(name: string, loader: Loader): Promise<string> {
  const file = cacheFile(name);
  let stale: string | undefined;
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < TTL_MS) return fs.readFileSync(file, 'utf8');
    stale = fs.readFileSync(file, 'utf8');
  } catch { /* no cache */ }
  let text: string;
  try {
    text = await loader(BASE + name);
  } catch (e: any) {
    if (stale) { console.error(`[abap-adt-mcp] ${name}: download failed (${e?.message || e}); using the cached copy`); return stale; }
    throw e;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, text, { mode: 0o600 });
  } catch { /* cache is best effort */ }
  return text;
}

export function buildIndex(edition: ReleaseEdition, releaseJson: string, classificationJson?: string): ReleaseIndex {
  const byName = new Map<string, ReleaseEntry[]>();
  const add = (map: Map<string, ReleaseEntry[]>, e: ReleaseEntry) => {
    const key = String(e.tadirObjName || e.objectKey || '').toUpperCase();
    if (!key) return;
    const list = map.get(key) || [];
    list.push(e);
    map.set(key, list);
  };
  const rel = JSON.parse(releaseJson);
  for (const e of rel.objectReleaseInfo || []) add(byName, e);
  const classificationByName = new Map<string, ReleaseEntry[]>();
  let classifications = 0;
  if (classificationJson) {
    const cls = JSON.parse(classificationJson);
    for (const e of cls.objectClassifications || []) { add(classificationByName, e); classifications++; }
  }
  return { edition, byName, classificationByName, loadedAt: new Date().toISOString(), counts: { released: (rel.objectReleaseInfo || []).length, classifications } };
}

const inFlight = new Map<string, Promise<ReleaseIndex>>();
export async function getReleaseIndex(edition: ReleaseEdition = 'cloud', loader: Loader = fetchText, force = false): Promise<ReleaseIndex> {
  const hit = memory.get(edition);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return hit.index;
  const key = `${edition}:${force}`;
  let p = inFlight.get(key);
  if (!p) {
    p = (async () => {
      const [rel, cls] = await Promise.all([
        loadFile(FILES[edition], loader),
        loadFile(CLASSIFICATIONS, loader).catch(() => undefined),
      ]);
      const index = buildIndex(edition, rel, cls);
      memory.set(edition, { index, at: Date.now() });
      return index;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

/** Normalize "CLAS:CL_X", "cl_x", "TABL MARA" into { name, type? }. */
export function parseObjectRef(ref: string): { name: string; type?: string } {
  const s = String(ref || '').trim().toUpperCase();
  const m = s.match(/^([A-Z]{4})[:\s/]+(.+)$/);
  if (m && !/^\//.test(s)) return { type: m[1], name: m[2].trim() };
  return { name: s };
}

/** Map an ADT object URL to a TADIR type and name (best effort). */
export function objectRefFromUrl(objectUrl: string): { name: string; type?: string } | undefined {
  const m = String(objectUrl || '').match(/\/sap\/bc\/adt\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return undefined;
  const name = decodeURIComponent(m[3]).toUpperCase();
  const seg = `${m[1]}/${m[2]}`;
  const map: Record<string, string> = {
    'oo/classes': 'CLAS', 'oo/interfaces': 'INTF', 'programs/programs': 'PROG', 'programs/includes': 'PROG',
    'ddic/tables': 'TABL', 'ddic/structures': 'TABL', 'ddic/dataelements': 'DTEL', 'ddic/domains': 'DOMA',
    'ddic/ddl': 'DDLS', 'functions/groups': 'FUGR', 'bo/behaviordefinitions': 'BDEF', 'ddic/srvd': 'SRVD',
    'businessservices/bindings': 'SRVB', 'packages': 'DEVC', 'ddic/tabletypes': 'TTYP', 'ddic/views': 'VIEW',
  };
  return { name, type: map[seg] };
}

export function lookup(index: ReleaseIndex, ref: { name: string; type?: string }): ReleaseVerdict {
  const name = ref.name.toUpperCase();
  const pick = (list: ReleaseEntry[] | undefined) => {
    if (!list || !list.length) return undefined;
    if (ref.type) return list.find(e => (e.tadirObject || e.objectType || '').toUpperCase() === ref.type) || undefined;
    return list[0];
  };
  const rel = pick(index.byName.get(name));
  if (rel) {
    return {
      name, type: rel.tadirObject || rel.objectType,
      state: rel.state,
      cloudReady: rel.state === 'released',
      successors: (rel.successors || []).map(s => ({ name: s.tadirObjName || s.objectKey || '', type: s.tadirObject || s.objectType || '' })),
      softwareComponent: rel.softwareComponent, applicationComponent: rel.applicationComponent,
      note: rel.state === 'deprecated' ? 'Deprecated for cloud development: use a successor if listed.' : undefined,
    };
  }
  const cls = pick(index.classificationByName.get(name));
  if (cls) {
    return {
      name, type: cls.tadirObject || cls.objectType,
      state: cls.state,
      cloudReady: false,
      successors: (cls.successors || []).map(s => ({ name: s.tadirObjName || s.objectKey || '', type: s.tadirObject || s.objectType || '' })),
      softwareComponent: cls.softwareComponent, applicationComponent: cls.applicationComponent,
      note: cls.state === 'classicAPI' ? 'Classic API: usable in classic ABAP and (with care) in the 3-tier extensibility model, not in ABAP Cloud.' : 'Not released for cloud development.',
    };
  }
  const customer = /^[YZ]|^\/[A-Z0-9]+\/[YZ]?/.test(name) && !/^\/(?:1BEA|1FB|1ISR|1SEM|ACCGO|AIF|BEV|CPD|DSD|IAM|ISDFPS|ISHCM|IWBEP|IWFND|IWWRK|MRSS|SAPSRM|SRMSMC|UI2|UI5)\//.test(name);
  // Names the repository does not know are uncertain, not proven blockers: the
  // repository lists SAP objects with a release decision, not every SAP object,
  // and the candidate scan is heuristic (a local type or constant looks the same).
  return {
    name, type: ref.type,
    state: customer ? 'customer' : 'unknown',
    cloudReady: customer,
    successors: [],
    note: customer ? 'Customer object (Y/Z namespace): not an SAP API; its own ABAP language version decides cloud readiness.' : 'Not listed in the SAP cloudification repository (neither released nor classified): verify in the system (ddicElement / abapDocumentation) before treating it as a blocker.',
  };
}

/** Uppercase identifiers in a source that look like SAP objects worth checking. */
export function candidatesFromSource(source: string): string[] {
  const text = String(source || '').replace(/^\s*[*"].*$/gm, '').replace(/"[^\n]*$/gm, '');
  const names = new Set<string>();
  // Names declared in the source itself (local classes, interfaces, types,
  // constants, data, field symbols, parameters) are not SAP APIs.
  const local = new Set<string>();
  const declRe = /\b(?:CLASS|INTERFACE|TYPES|DATA|CONSTANTS|STATICS|FIELD-SYMBOLS|PARAMETERS|SELECT-OPTIONS|TABLES|CLASS-DATA|BEGIN\s+OF)\s+([A-Za-z_/][\w/]*)/gi;
  let d: RegExpExecArray | null;
  while ((d = declRe.exec(text))) local.add(d[1].toUpperCase());
  const enumRe = /\b(?:DATA|TYPES|CONSTANTS|CLASS-DATA|STATICS)\s*:\s*([^.]+)\./gi;
  while ((d = enumRe.exec(text))) for (const part of d[1].split(',')) { const m = part.trim().match(/^([A-Za-z_/][\w/]*)/); if (m) local.add(m[1].toUpperCase()); }
  const patterns = [
    /\b(?:FROM|JOIN|INTO\s+TABLE\s+@?\w+\s+FROM|UPDATE|MODIFY|DELETE\s+FROM|INSERT\s+INTO)\s+([A-Za-z_/][\w/]*)/gi,
    /\b(?:TYPE\s+(?:STANDARD|SORTED|HASHED)\s+TABLE\s+OF|TYPE\s+TABLE\s+OF|TYPE\s+REF\s+TO|TYPE|LIKE\s+LINE\s+OF|LIKE)\s+([A-Za-z_/][\w/]*)/gi,
    /\b(CL_[\w/]*|IF_[\w/]*|CX_[\w/]*)\b/gi,
    /\bCALL\s+FUNCTION\s+'([^']+)'/gi,
    /\bINTERFACES\s+([A-Za-z_/][\w/]*)/gi,
    /\bINHERITING\s+FROM\s+([A-Za-z_/][\w/]*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = m[1].toUpperCase();
      if (/^(I|C|N|D|T|X|P|F|STRING|XSTRING|INT8|DECFLOAT16|DECFLOAT34|UTCLONG|ABAP_BOOL|ANY|DATA|OBJECT|SIMPLE|CLIKE|NUMERIC|TABLE|SY|SYST|ME|SUPER)$/.test(n)) continue;
      if (/^[YZ]/.test(n)) continue;
      if (local.has(n)) continue;
      names.add(n);
    }
  }
  return [...names];
}

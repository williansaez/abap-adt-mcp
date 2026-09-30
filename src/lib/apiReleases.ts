/**
 * ABAP Cloud / Clean Core release state of SAP objects.
 *
 * Source of truth: SAP's public cloudification repository
 * (github.com/SAP/abap-atc-cr-cv-s4hc), the same JSON the ATC "cloud
 * readiness" checks consume. Fetched once per edition, cached in memory and
 * on disk (~/.abap-adt-mcp/cache) for 24 hours.
 *
 * SAP announced (API Policy overview, 2026-05-30) that the repository will
 * also classify non-released and explicitly prohibited interfaces. Nothing
 * here depends on the exact shape of that content: every entry array of a
 * file is read whatever its key, states and labels this version does not know
 * are passed through and flagged, a state or label that says "prohibited"
 * (or unpermitted, forbidden, not allowed) outranks every other answer, and
 * MCP_API_CLASSIFICATION_FILES adds files without a new release of the server.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export type ReleaseEdition = 'cloud' | 'btp' | 'pce' | 'pce2025' | 'pce2023' | 'pce2022';
export const RELEASE_EDITIONS: ReleaseEdition[] = ['cloud', 'btp', 'pce', 'pce2025', 'pce2023', 'pce2022'];

const FILES: Record<ReleaseEdition, string> = {
  cloud: 'objectReleaseInfoLatest.json',
  btp: 'objectReleaseInfo_BTPLatest.json',
  pce: 'objectReleaseInfo_PCELatest.json',
  pce2025: 'objectReleaseInfo_PCE2025_2.json',
  pce2023: 'objectReleaseInfo_PCE2023_3.json',
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
  successorConceptName?: string;
  labels?: string[];
  successors?: Array<{ tadirObject: string; tadirObjName: string; objectType?: string; objectKey?: string }>;
  /** File the entry was read from (set while indexing). */
  source?: string;
}

/**
 * Standing of an object derived from the repository: released (released API),
 * classic (classic API), notReleased (SAP-internal, no release for customer
 * use), prohibited (explicitly not permitted), customer, unknown. A reading of
 * SAP's published classification, not a legal assessment.
 */
export type ApiPolicyStanding = 'released' | 'classic' | 'notReleased' | 'prohibited' | 'customer' | 'unknown';

const KNOWN_STATES = new Set(['released', 'deprecated', 'notToBeReleased', 'notToBeReleasedStable', 'classicAPI', 'noAPI']);

/**
 * Interfaces SAP has declared not permitted for customer and third-party use
 * in an SAP Note, listed here until the repository carries the classification
 * itself. Matched by name prefix.
 */
export const DECLARED_UNPERMITTED: Array<{ prefix: string; what: string; sapNote: string }> = [
  { prefix: 'RODPS_REPL', what: 'ODP Data Replication API over RFC (ODP-RFC)', sapNote: '3255746' },
];

const PROHIBITED_MARKER = /prohibit|forbid|unpermitted|notpermitted|notallowed|disallowed/;
const squash = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
/** True when the state or a label of an entry says the interface must not be used. */
export function isProhibited(e: Pick<ReleaseEntry, 'state' | 'labels'>): boolean {
  return PROHIBITED_MARKER.test(squash(e.state)) || (Array.isArray(e.labels) && e.labels.some(l => PROHIBITED_MARKER.test(squash(l))));
}

export interface ReleaseIndex {
  edition: ReleaseEdition;
  byName: Map<string, ReleaseEntry[]>;         // NAME -> entries (any type)
  classificationByName: Map<string, ReleaseEntry[]>;
  loadedAt: string;
  counts: { released: number; classifications: number };
  /** Files named in MCP_API_CLASSIFICATION_FILES: how many entries each gave, or why it could not be read. */
  extraFiles: Array<{ file: string; entries?: number; error?: string }>;
}

export interface ReleaseVerdict {
  name: string;
  type?: string;
  /** released | deprecated | notToBeReleased | notToBeReleasedStable | classicAPI | noAPI | unknown (not in the repository) | customer | unpermitted (declared in an SAP Note) | any state the repository adds later */
  state: string;
  apiPolicy: ApiPolicyStanding;
  cloudReady: boolean;
  labels?: string[];
  /** Successor given as a concept instead of an object. */
  successorConcept?: string;
  /** The repository used a state this version of the server does not know. */
  unrecognizedState?: boolean;
  sapNote?: string;
  /** File the verdict came from, when it is not one of the two standard files. */
  source?: string;
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

/**
 * Entries of MCP_API_CLASSIFICATION_FILES: a path inside the repository's src
 * folder (partner/objectClassifications_ACME.json) or an https URL.
 */
export function extraClassificationFiles(env: NodeJS.ProcessEnv = process.env): Array<{ file: string; url: string; cacheName: string }> {
  const out: Array<{ file: string; url: string; cacheName: string }> = [];
  for (const raw of String(env.MCP_API_CLASSIFICATION_FILES || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (/^https:\/\//i.test(raw)) {
      out.push({ file: raw, url: raw, cacheName: 'extra-' + raw.replace(/^https:\/\//i, '').replace(/[^\w.-]+/g, '_').slice(0, 150) });
    } else if (/^[\w][\w./-]*\.json$/.test(raw) && !raw.includes('..')) {
      out.push({ file: raw, url: BASE + raw, cacheName: raw.replace(/\//g, '_') });
    } else {
      throw new Error(`MCP_API_CLASSIFICATION_FILES: "${raw}" is neither an https URL nor a .json path inside the repository`);
    }
  }
  return out;
}

/** Read a repository file from disk cache (fresh) or the network, updating the cache; a stale cache beats a failed download. */
async function loadFile(name: string, loader: Loader, url: string = BASE + name): Promise<string> {
  const file = cacheFile(name);
  let stale: string | undefined;
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < TTL_MS) return fs.readFileSync(file, 'utf8');
    stale = fs.readFileSync(file, 'utf8');
  } catch { /* no cache */ }
  let text: string;
  try {
    text = await loader(url);
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

/** Every entry of a repository file, whatever key its array sits under: an object with a name and a state. */
export function entriesOf(json: string): ReleaseEntry[] {
  const parsed = JSON.parse(json);
  const out: ReleaseEntry[] = [];
  for (const v of Object.values(parsed && typeof parsed === 'object' ? parsed : {})) {
    if (!Array.isArray(v)) continue;
    for (const e of v) if (e && typeof e === 'object' && e.state && (e.tadirObjName || e.objectKey)) out.push(e);
  }
  return out;
}

export type ExtraFile = { file: string; json?: string; error?: string };

export function buildIndex(edition: ReleaseEdition, releaseJson: string, classificationJson?: string, extras: ExtraFile[] = []): ReleaseIndex {
  const byName = new Map<string, ReleaseEntry[]>();
  const add = (map: Map<string, ReleaseEntry[]>, e: ReleaseEntry, source?: string) => {
    const key = String(e.tadirObjName || e.objectKey || '').toUpperCase();
    if (!key) return;
    const list = map.get(key) || [];
    list.push(source ? { ...e, source } : e);
    map.set(key, list);
  };
  const released = entriesOf(releaseJson);
  for (const e of released) add(byName, e);
  const classificationByName = new Map<string, ReleaseEntry[]>();
  let classifications = 0;
  if (classificationJson) {
    for (const e of entriesOf(classificationJson)) { add(classificationByName, e); classifications++; }
  }
  const extraFiles: ReleaseIndex['extraFiles'] = [];
  for (const x of extras) {
    if (x.json === undefined) { extraFiles.push({ file: x.file, error: x.error || 'not loaded' }); continue; }
    try {
      const list = entriesOf(x.json);
      for (const e of list) { add(classificationByName, e, x.file); classifications++; }
      extraFiles.push({ file: x.file, entries: list.length });
    } catch (e: any) {
      extraFiles.push({ file: x.file, error: `not valid JSON: ${e?.message || e}` });
    }
  }
  return { edition, byName, classificationByName, loadedAt: new Date().toISOString(), counts: { released: released.length, classifications }, extraFiles };
}

const inFlight = new Map<string, Promise<ReleaseIndex>>();
export async function getReleaseIndex(edition: ReleaseEdition = 'cloud', loader: Loader = fetchText, force = false): Promise<ReleaseIndex> {
  const hit = memory.get(edition);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return hit.index;
  const key = `${edition}:${force}`;
  let p = inFlight.get(key);
  if (!p) {
    p = (async () => {
      const [rel, cls, extras] = await Promise.all([
        loadFile(FILES[edition], loader),
        loadFile(CLASSIFICATIONS, loader).catch(() => undefined),
        // A file the operator named and the server cannot read is reported in
        // the answer, not dropped: a missing prohibition list must be visible.
        Promise.all(extraClassificationFiles().map(async (x): Promise<ExtraFile> => {
          try { return { file: x.file, json: await loadFile(x.cacheName, loader, x.url) }; }
          catch (e: any) { return { file: x.file, error: String(e?.message || e) }; }
        })),
      ]);
      const index = buildIndex(edition, rel, cls, extras);
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

const successorsOf = (e: ReleaseEntry) => (e.successors || []).map(s => ({ name: s.tadirObjName || s.objectKey || '', type: s.tadirObject || s.objectType || '' }));

const NOT_RELEASED_NOTE = 'SAP-internal object without a release for customer use. Under SAP\'s API Policy a non-published interface is used at the customer\'s own risk and is not supported.';

/** Fields every verdict built from a repository entry shares. */
function fromEntry(name: string, e: ReleaseEntry): Pick<ReleaseVerdict, 'name' | 'type' | 'state' | 'successors' | 'softwareComponent' | 'applicationComponent' | 'labels' | 'successorConcept' | 'unrecognizedState' | 'source'> {
  return {
    name, type: e.tadirObject || e.objectType,
    state: e.state,
    successors: successorsOf(e),
    softwareComponent: e.softwareComponent, applicationComponent: e.applicationComponent,
    ...(Array.isArray(e.labels) && e.labels.length ? { labels: e.labels } : {}),
    ...(e.successorConceptName ? { successorConcept: e.successorConceptName } : {}),
    ...(KNOWN_STATES.has(e.state) ? {} : { unrecognizedState: true }),
    ...(e.source ? { source: e.source } : {}),
  };
}

export function lookup(index: ReleaseIndex, ref: { name: string; type?: string }): ReleaseVerdict {
  const name = ref.name.toUpperCase();
  const ofType = (list: ReleaseEntry[] | undefined) => (list || []).filter(e => !ref.type || (e.tadirObject || e.objectType || '').toUpperCase() === ref.type);
  const pick = (list: ReleaseEntry[] | undefined) => {
    if (!list || !list.length) return undefined;
    if (ref.type) return ofType(list)[0];
    return list[0];
  };

  // A prohibition outranks every other answer, whichever file carries it.
  const banned = [...ofType(index.byName.get(name)), ...ofType(index.classificationByName.get(name))].find(isProhibited);
  if (banned) {
    return {
      ...fromEntry(name, banned),
      apiPolicy: 'prohibited', cloudReady: false,
      note: 'Classified as not permitted in SAP\'s cloudification repository: do not call it from customer or third-party code; use a successor if listed.',
    };
  }
  const declared = DECLARED_UNPERMITTED.find(d => name.startsWith(d.prefix));
  if (declared) {
    return {
      name, type: ref.type, state: 'unpermitted', apiPolicy: 'prohibited', cloudReady: false, successors: [],
      sapNote: declared.sapNote,
      note: `${declared.what}: SAP Note ${declared.sapNote} declares its use by customer and third-party applications not permitted.`,
    };
  }

  const rel = pick(index.byName.get(name));
  if (rel) {
    const known = KNOWN_STATES.has(rel.state);
    const released = rel.state === 'released';
    return {
      ...fromEntry(name, rel),
      apiPolicy: released || rel.state === 'deprecated' ? 'released' : 'notReleased',
      cloudReady: released,
      note: rel.state === 'deprecated' ? 'Deprecated for cloud development: use a successor if listed.'
        : released ? undefined
        : !known ? `The repository gives the state "${rel.state}", which this version of the server does not know: treated as not released. Read the state as SAP wrote it.`
        : NOT_RELEASED_NOTE + (rel.state === 'notToBeReleasedStable' ? ' The repository marks it as stable.' : ''),
    };
  }
  const cls = pick(index.classificationByName.get(name));
  if (cls) {
    const known = KNOWN_STATES.has(cls.state);
    return {
      ...fromEntry(name, cls),
      apiPolicy: cls.state === 'classicAPI' ? 'classic' : 'notReleased',
      cloudReady: false,
      note: cls.state === 'classicAPI' ? 'Classic API: usable in classic ABAP and (with care) in the 3-tier extensibility model, not in ABAP Cloud.'
        : !known ? `The repository gives the state "${cls.state}", which this version of the server does not know: treated as not released. Read the state as SAP wrote it.`
        : 'Not released for cloud development. ' + NOT_RELEASED_NOTE,
    };
  }
  const customer = /^[YZ]|^\/[A-Z0-9]+\/[YZ]?/.test(name) && !/^\/(?:1BEA|1FB|1ISR|1SEM|ACCGO|AIF|BEV|CPD|DSD|IAM|ISDFPS|ISHCM|IWBEP|IWFND|IWWRK|MRSS|SAPSRM|SRMSMC|UI2|UI5)\//.test(name);
  // Names the repository does not know are uncertain, not proven blockers: the
  // repository lists SAP objects with a release decision, not every SAP object,
  // and the candidate scan is heuristic (a local type or constant looks the same).
  return {
    name, type: ref.type,
    state: customer ? 'customer' : 'unknown',
    apiPolicy: customer ? 'customer' : 'unknown',
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

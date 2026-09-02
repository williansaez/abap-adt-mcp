/**
 * Per-destination capability profile derived from ADT discovery: which
 * collections the backend exposes decides which toolsets can work there
 * (S/4HANA Cloud tenants lack several on-prem endpoints).
 */

export const FEATURE_COLLECTIONS: Record<string, string> = {
  debugger: '/sap/bc/adt/debugger',
  traces: '/sap/bc/adt/runtime/traces',
  abapGit: '/sap/bc/adt/abapgit/repos',
  atc: '/sap/bc/adt/atc',
  rapGenerator: '/sap/bc/adt/businessservices/generators',
  serviceBindings: '/sap/bc/adt/businessservices/bindings',
  textSearch: '/sap/bc/adt/repository/informationsystem/textsearch',
  apiReleases: '/sap/bc/adt/apireleases',
  systemInformation: '/sap/bc/adt/system/information',
  feeds: '/sap/bc/adt/feeds',
  dataPreview: '/sap/bc/adt/datapreview',
  unitTests: '/sap/bc/adt/abapunit',
  refactorings: '/sap/bc/adt/refactorings',
  packages: '/sap/bc/adt/packages',
  checkRuns: '/sap/bc/adt/checkruns',
};

/** Toolset -> feature that must be present for its tools to work. */
export const TOOLSET_FEATURE: Record<string, string> = {
  debugger: 'debugger',
  traces: 'traces',
  git: 'abapGit',
  atc: 'atc',
  rap: 'rapGenerator',
  services: 'serviceBindings',
  runtime: 'feeds',
  tests: 'unitTests',
  data: 'dataPreview',
  refactoring: 'refactorings',
};

export interface SystemProfile {
  destination: string;
  url: string;
  client?: string;
  authType: string;
  platform: 'cloud' | 'onprem' | 'unknown';
  platformReason: string;
  systemInformation?: Record<string, string>;
  collections: number;
  features: Record<string, boolean>;
  unavailableToolsets: string[];
  unavailableTools: string[];
  builtAt: string;
}

const CLOUD_HOST = /\.s4hana\.cloud\.sap$|\.abap(?:-web)?\.(?:[a-z]{2}\d*)\.hana\.ondemand\.com$|\.s4hana\.ondemand\.com$/i;

export function collectionHrefs(discovery: any): Set<string> {
  const hrefs = new Set<string>();
  const list = Array.isArray(discovery) ? discovery : (discovery?.discovery || discovery?.result || []);
  for (const ws of list) {
    for (const c of (ws?.collection || [])) if (c?.href) hrefs.add(String(c.href));
  }
  return hrefs;
}

export function detectFeatures(hrefs: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const arr = [...hrefs];
  for (const [feature, prefix] of Object.entries(FEATURE_COLLECTIONS)) {
    out[feature] = arr.some(h => h === prefix || h.startsWith(prefix + '/') || h.startsWith(prefix + '?'));
  }
  return out;
}

/** Lenient key/value extraction from an unknown XML or JSON body (system information). */
export function parseSystemInformation(body: string | undefined): Record<string, string> | undefined {
  if (!body) return undefined;
  const text = String(body).trim();
  if (!text) return undefined;
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(json)) if (v !== null && typeof v !== 'object') flat[k] = String(v);
      return flat;
    } catch { /* fall through */ }
  }
  const flat: Record<string, string> = {};
  const NOISE = new Set(['version', 'encoding', 'xmlns', 'schemaLocation']);
  const attrRe = /\b([\w:.-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(text)) && Object.keys(flat).length < 60) {
    const key = m[1].replace(/^.*:/, '');
    if (!/^xmlns/.test(m[1]) && !NOISE.has(key) && !(key in flat)) flat[key] = m[2];
  }
  const elRe = /<([\w:.-]+)[^>]*>([^<]{1,200})<\/\1>/g;
  while ((m = elRe.exec(text)) && Object.keys(flat).length < 80) {
    const key = m[1].replace(/^.*:/, '');
    if (!(key in flat)) flat[key] = m[2].trim();
  }
  return Object.keys(flat).length ? flat : undefined;
}

export function buildSystemProfile(input: {
  destination: string; url: string; client?: string; authType: string;
  discovery: any; systemInformationBody?: string;
  toolsOfToolset: (toolset: string) => string[];
  now?: string;
}): SystemProfile {
  const hrefs = collectionHrefs(input.discovery);
  const features = detectFeatures(hrefs);
  const info = parseSystemInformation(input.systemInformationBody);
  let host = '';
  try { host = new URL(input.url).hostname; } catch { /* keep empty */ }

  let platform: SystemProfile['platform'] = 'unknown';
  let platformReason = 'could not determine from host name or discovery';
  const infoText = JSON.stringify(info || {}).toLowerCase();
  if (CLOUD_HOST.test(host)) {
    platform = 'cloud'; platformReason = `host ${host} is an SAP cloud tenant domain`;
  } else if (/abap cloud|cloud/.test(infoText) && !/on.?prem/.test(infoText)) {
    platform = 'cloud'; platformReason = 'system information reports a cloud edition';
  } else if (features.textSearch === false && features.abapGit === false && features.rapGenerator === false && hrefs.size < 200) {
    platform = 'onprem'; platformReason = 'classic ADT collection set without cloud-only services';
  } else if (hrefs.size > 0) {
    platform = 'onprem'; platformReason = `host ${host} is not a known cloud domain`;
  }

  const unavailableToolsets = Object.entries(TOOLSET_FEATURE)
    .filter(([, feature]) => features[feature] === false)
    .map(([toolset]) => toolset);
  const unavailableTools = unavailableToolsets.flatMap(ts => input.toolsOfToolset(ts));

  return {
    destination: input.destination,
    url: input.url,
    client: input.client,
    authType: input.authType,
    platform,
    platformReason,
    systemInformation: info,
    collections: hrefs.size,
    features,
    unavailableToolsets,
    unavailableTools,
    builtAt: input.now || new Date().toISOString(),
  };
}

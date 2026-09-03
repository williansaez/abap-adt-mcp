/**
 * Tolerant argument names. Field reports showed agents guessing
 * `TransportNumber` for `transportNumber`, `objectSourceUrl` for
 * `objSourceUrl`, `source` for `code`, `description` for `REQUEST_TEXT` and
 * so on: the same concept is named differently across tools that were
 * inherited from several upstream generations. Rather than renaming
 * parameters (which would break existing prompts and skills), the dispatcher
 * maps what the caller sent onto what the tool's schema declares:
 *   1. case-insensitive match of a key to a schema property;
 *   2. otherwise, a key from a known alias group is moved to the schema
 *      property of the same group that is still missing (required first).
 * Nothing is moved when the target key is already present.
 */

const GROUPS: string[][] = [
  ['objectUrl', 'objectSourceUrl', 'objSourceUrl', 'objectUri', 'sourceUrl', 'uri', 'url', 'classUrl', 'mainUrl', 'cdsUrl', 'domainUrl', 'dataElementUrl'],
  ['transportNumber', 'transport', 'trkorr', 'transportRequest', 'request'],
  ['clas', 'className', 'class', 'clsName', 'classUrl', 'clas_name'],
  ['REQUEST_TEXT', 'description', 'text', 'requestText', 'title'],
  ['DEVCLASS', 'packageName', 'package', 'devclass', 'parentName', 'packagename'],
  ['objectName', 'name', 'objName', 'objname'],
  ['objtype', 'objType', 'objectType', 'type'],
  ['methodName', 'method'],
  ['code', 'source', 'body', 'sourceCode', 'abap'],
  ['sqlQuery', 'sql', 'query', 'statement'],
  ['ddicEntityName', 'tableName', 'table', 'entityName', 'entity'],
  ['clsInclude', 'include'],
  ['lockHandle', 'lock_handle', 'LOCK_HANDLE', 'handle'],
  ['pattern', 'searchString', 'search', 'text'],
  ['dumpId', 'id'],
  ['repoId', 'repository', 'repo'],
];

const lower = (s: string) => s.toLowerCase();

export interface NormalizedArgs {
  args: Record<string, unknown>;
  /** callerKey -> schemaKey for every argument that was renamed. */
  renamed: Record<string, string>;
}

export function normalizeArgs(schema: any, input: Record<string, unknown> | undefined): NormalizedArgs {
  const args: Record<string, unknown> = { ...(input || {}) };
  const renamed: Record<string, string> = {};
  const props: string[] = Object.keys(schema?.properties || {});
  if (!props.length) return { args, renamed };
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  const byLower = new Map(props.map(p => [lower(p), p]));
  const has = (k: string) => args[k] !== undefined;

  for (const key of Object.keys(args)) {
    if (props.includes(key)) continue;
    // 1. Same name, different case (TransportNumber -> transportNumber).
    const ci = byLower.get(lower(key));
    if (ci && !has(ci)) { args[ci] = args[key]; delete args[key]; renamed[key] = ci; continue; }
    // 2. Alias group: pick the schema property of the same group that is still missing.
    const groups = GROUPS.filter(g => g.some(a => lower(a) === lower(key)));
    let target: string | undefined;
    for (const g of groups) {
      const candidates = g.map(a => byLower.get(lower(a))).filter((p): p is string => !!p && !has(p) && p !== key);
      target = candidates.find(p => required.has(p)) ?? candidates[0];
      if (target) break;
    }
    if (target) { args[target] = args[key]; delete args[key]; renamed[key] = target; }
  }
  return { args, renamed };
}

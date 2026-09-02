/**
 * Parsing and helpers for source text search: the ADT repository text search
 * endpoint (server-side index) and the client-side grep over package sources.
 */

export interface TextSearchMatch {
  objectUrl: string;
  name: string;
  type: string;
  packageName?: string;
  description?: string;
  line?: number;
  snippet?: string;
}

const attr = (el: string, name: string): string | undefined => {
  const m = el.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : undefined;
};
export function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

/**
 * Lenient parser for the text search response. Handles both shapes seen in
 * the wild: <…:searchResultObject adtcore:uri adtcore:name adtcore:type …>
 * with nested <…:searchResultMatch line="…">snippet</…>, and flat
 * <adtcore:objectReference …/> lists without matches.
 */
export function parseTextSearchResponse(xml: string): TextSearchMatch[] {
  const out: TextSearchMatch[] = [];
  const text = String(xml || '');
  // Objects with a body (possibly containing matches)
  const objRe = /<([\w.-]+:)?(searchResultObject|objectReference)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1?\2>)/gi;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const attrs = m[3];
    const body = m[5] || '';
    const base: TextSearchMatch = {
      objectUrl: attr(attrs, 'uri') || '',
      name: attr(attrs, 'name') || '',
      type: attr(attrs, 'type') || '',
      packageName: attr(attrs, 'packageName'),
      description: attr(attrs, 'description'),
    };
    if (!base.objectUrl && !base.name) continue;
    const matchRe = /<([\w.-]+:)?searchResultMatch\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1?searchResultMatch>)/gi;
    let mm: RegExpExecArray | null;
    let any = false;
    while ((mm = matchRe.exec(body))) {
      any = true;
      const lineStr = attr(mm[2], 'line') || attr(mm[2], 'lineNumber');
      const inner = mm[3] || '';
      const snippetEl = inner.match(/<([\w.-]+:)?snippet\b[^>]*>([\s\S]*?)<\/\1?snippet>/i);
      const snippet = decodeEntities((snippetEl ? snippetEl[2] : inner).replace(/<[^>]+>/g, '')).trim();
      out.push({ ...base, line: lineStr ? parseInt(lineStr, 10) : undefined, snippet: snippet || undefined });
    }
    if (!any) out.push(base);
  }
  return out;
}

/** Object types whose main source we can grep, mapped to their source URL. */
export const GREPPABLE_TYPES: Record<string, (objectUri: string) => string> = {
  'CLAS/OC': (u) => `${u}/source/main`,
  'INTF/OI': (u) => `${u}/source/main`,
  'PROG/P': (u) => `${u}/source/main`,
  'PROG/I': (u) => `${u}/source/main`,
  'DDLS/DF': (u) => `${u}/source/main`,
  'DCLS/DL': (u) => `${u}/source/main`,
  'DDLX/EX': (u) => `${u}/source/main`,
  'BDEF/BDO': (u) => `${u}/source/main`,
  'SRVD/SRV': (u) => `${u}/source/main`,
  'FUGR/FF': (u) => `${u}/source/main`,
  'FUGR/I': (u) => `${u}/source/main`,
};

export interface GrepHit {
  objectUrl: string;
  name: string;
  type: string;
  line: number;
  text: string;
  context?: string[];
}

/** Regex search of one source; returns hits with optional context lines. */
export function grepSource(source: string, re: RegExp, contextLines: number, maxHits: number, meta: { objectUrl: string; name: string; type: string }): GrepHit[] {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const hits: GrepHit[] = [];
  for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
    re.lastIndex = 0;
    if (re.test(lines[i])) {
      const hit: GrepHit = { ...meta, line: i + 1, text: lines[i] };
      if (contextLines > 0) {
        hit.context = lines.slice(Math.max(0, i - contextLines), Math.min(lines.length, i + contextLines + 1));
      }
      hits.push(hit);
    }
  }
  return hits;
}

/** Build the RegExp for grep: literal by default, regex when asked; always case-insensitive unless told otherwise. */
export function buildPattern(pattern: string, isRegex: boolean, caseSensitive: boolean): RegExp {
  const src = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(src, caseSensitive ? '' : 'i');
}

/** Run `fn` over items with bounded concurrency, preserving order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

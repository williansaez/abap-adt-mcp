/**
 * Helpers for the ADT short dump feed. The feed's `text` per dump is a large
 * HTML document (header table, analysis paragraphs, source extract, call
 * stack). Agents need a few fields, not the markup, so we extract them.
 */

export interface DumpStackFrame {
  no: number;
  event: string;
  program: string;
  include: string;
  line: number | null;
  sourceUrl?: string;
}

export interface DumpSummary {
  dumpId: string;
  timestamp?: string;
  user?: string;
  runtimeError?: string;
  exception?: string;
  shortText?: string;
  program?: string;
  applicationComponent?: string;
  dateTime?: string;
  client?: string;
  host?: string;
  terminatedAt?: { objectSourceUrl: string; line: number | null };
  whatHappened?: string;
  errorAnalysis?: string;
  whereTerminated?: string;
  stack: DumpStackFrame[];
}

const decode = (s: string) => s
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();

/** Strip the `adt://SID` prefix so the URL can be fed to getObjectSource. */
export function adtLinkToPath(href: string): string {
  return href.replace(/^adt:\/\/[^/]+/, '');
}

/** The id segment of a dump from any of the forms the feed uses. */
export function normalizeDumpId(input: string): string {
  let s = String(input || '').trim();
  s = adtLinkToPath(s);
  const m = s.match(/\/(?:vit\/)?runtime\/dumps?\/(.+)$/);
  if (m) s = m[1];
  s = s.replace(/^\/+/, '');
  // Keep the id percent-encoded exactly as ADT emits it (it contains spaces).
  return /%[0-9A-Fa-f]{2}/.test(s) ? s : encodeURIComponent(s);
}

function headerField(html: string, label: string): string | undefined {
  const re = new RegExp(`<b>${label}(?:&nbsp;)?\\s*</b>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i');
  const m = html.match(re);
  return m ? decode(m[1]) : undefined;
}

function section(html: string, id: string): string | undefined {
  const re = new RegExp(`<h4 id="${id}">[\\s\\S]*?</h4>([\\s\\S]*?)(?=<h4 |<style|$)`, 'i');
  const m = html.match(re);
  return m ? decode(m[1]) : undefined;
}

export function parseDumpStack(html: string): DumpStackFrame[] {
  const frames: DumpStackFrame[] = [];
  const stackHtml = html.split(/<h4 id="STACK">/i)[1];
  if (!stackHtml) return frames;
  const rowRe = /<tr>\s*<td><code>(?:<a href="([^"]*)">)?(\d+)(?:<\/a>)?<\/code><\/td>\s*<td><code>([^<]*)<\/code><\/td>\s*<td><code>([^<]*)<\/code><\/td>\s*<td><code>([^<]*)<\/code><\/td>\s*<td><code>([^<]*)<\/code><\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(stackHtml))) {
    const line = parseInt(m[6], 10);
    frames.push({
      no: parseInt(m[2], 10),
      event: decode(m[3]), program: decode(m[4]), include: decode(m[5]),
      line: Number.isFinite(line) ? line : null,
      sourceUrl: m[1] ? adtLinkToPath(decode(m[1])) : undefined
    });
  }
  return frames;
}

export function summarizeDump(dump: any): DumpSummary {
  const html: string = String(dump?.text || '');
  const selfLink = (dump?.links || []).find((l: any) => l.rel === 'self')?.href || dump?.id || '';
  const dumpId = normalizeDumpId(selfLink);
  const tsMatch = decodeURIComponent(dumpId).match(/^(\d{14})/);
  const timestamp = tsMatch
    ? `${tsMatch[1].slice(0, 4)}-${tsMatch[1].slice(4, 6)}-${tsMatch[1].slice(6, 8)}T${tsMatch[1].slice(8, 10)}:${tsMatch[1].slice(10, 12)}:${tsMatch[1].slice(12, 14)}`
    : undefined;
  const term = html.match(/<a title="Show where terminated" href="([^"]+)"/i);
  let terminatedAt: DumpSummary['terminatedAt'];
  if (term) {
    const href = decode(term[1]);
    const lm = href.match(/#start=(\d+)/);
    terminatedAt = { objectSourceUrl: adtLinkToPath(href).replace(/#.*$/, ''), line: lm ? parseInt(lm[1], 10) : null };
  }
  const runtimeError = headerField(html, 'Runtime Error')
    || (dump?.categories || []).find((c: any) => c.label === 'ABAP runtime error')?.term;
  const program = headerField(html, 'Program')
    || (dump?.categories || []).find((c: any) => c.label === 'Terminated ABAP program')?.term;
  return {
    dumpId,
    timestamp,
    user: dump?.author,
    runtimeError,
    exception: headerField(html, 'Exception'),
    shortText: headerField(html, 'Short Text'),
    program,
    applicationComponent: headerField(html, 'Application Component'),
    dateTime: headerField(html, 'Date/Time'),
    client: headerField(html, 'Client'),
    host: headerField(html, 'Host'),
    terminatedAt,
    whatHappened: section(html, 'WHATHAPPENED'),
    errorAnalysis: section(html, 'ERROR'),
    whereTerminated: section(html, 'TERMINATION'),
    stack: parseDumpStack(html)
  };
}

/** Normalize a from/to filter (YYYYMMDDHHMMSS, YYYY-MM-DD, or ISO) to 14 digits. */
export function toCompactTimestamp(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d{14}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return s + '000000';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp "${s}": use YYYYMMDDHHMMSS, YYYY-MM-DD or ISO 8601`);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

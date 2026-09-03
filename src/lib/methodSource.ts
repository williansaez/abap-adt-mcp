/**
 * Locate METHOD … ENDMETHOD blocks in ABAP class sources by scanning lines,
 * ignoring comment lines so a stray "ENDMETHOD" in a comment cannot close a
 * block early. Handles regular methods, interface methods (if~m), namespaced
 * names and AMDP headers (METHOD m BY DATABASE PROCEDURE …).
 */

export interface MethodBlock {
  name: string;
  startLine: number;   // 1-based, the METHOD line
  endLine: number;     // 1-based, the ENDMETHOD line
  text: string;
  amdp: boolean;
}

const isComment = (line: string) => /^\*/.test(line) || /^\s*"/.test(line);
const METHOD_RE = /^\s*METHOD\s+([\w~\/]+)\s*(?:\.|\s+BY\s+(DATABASE|KERNEL)\b)/i;
const END_RE = /^\s*ENDMETHOD\s*\./i;

export function listMethods(source: string): MethodBlock[] {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MethodBlock[] = [];
  let open: { name: string; start: number; amdp: boolean } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isComment(line)) continue;
    if (!open) {
      const m = line.match(METHOD_RE);
      if (m) open = { name: m[1].toUpperCase(), start: i, amdp: !!m[2] };
      continue;
    }
    if (END_RE.test(line)) {
      blocks.push({ name: open.name, startLine: open.start + 1, endLine: i + 1, text: lines.slice(open.start, i + 1).join('\n'), amdp: open.amdp });
      open = undefined;
    }
  }
  return blocks;
}

export function findMethod(source: string, methodName: string): MethodBlock | undefined {
  const wanted = methodName.toUpperCase();
  return listMethods(source).find(b => b.name === wanted);
}

/**
 * Replace a method block. `newSource` may be a full METHOD…ENDMETHOD block or
 * only the body; a body is wrapped with the existing header and footer lines.
 */
export function replaceMethod(source: string, block: MethodBlock, newSource: string): { source: string; wrapped: boolean } {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const incoming = String(newSource || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const hasHeader = METHOD_RE.test(incoming.split('\n').find(l => !isComment(l) && l.trim()) || '');
  const hasFooter = END_RE.test([...incoming.split('\n')].reverse().find(l => !isComment(l) && l.trim()) || '');
  let replacement: string[];
  let wrapped = false;
  if (hasHeader && hasFooter) {
    replacement = incoming.split('\n');
  } else {
    const header = lines[block.startLine - 1];
    const footer = lines[block.endLine - 1];
    replacement = [header, ...incoming.split('\n'), footer];
    wrapped = true;
  }
  lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...replacement);
  return { source: lines.join('\n'), wrapped };
}

/** Class object URL from a name or a URL (source/include suffixes stripped). */
export function classUrlOf(classUrlOrName: string): string {
  const s = String(classUrlOrName || '').trim();
  if (s.startsWith('/')) return s.replace(/[#?].*$/, '').replace(/\/(source\/main|includes\/[^/]+)$/i, '').replace(/\/$/, '');
  return `/sap/bc/adt/oo/classes/${encodeURIComponent(s.toLowerCase())}`;
}

/** Source URL of a class include: main (definition + implementations), implementations (local classes), testclasses, definitions, macros. */
export function includeSourceUrl(classUrl: string, include?: string): string {
  const inc = String(include || 'main').toLowerCase();
  if (inc === 'main') return `${classUrl}/source/main`;
  return `${classUrl}/includes/${inc}`;
}

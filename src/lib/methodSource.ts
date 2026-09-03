/**
 * Locate METHOD … ENDMETHOD blocks in ABAP class sources by scanning lines,
 * ignoring comment lines so a stray "ENDMETHOD" in a comment cannot close a
 * block early. Handles regular methods, interface methods (if~m), namespaced
 * names and AMDP headers (METHOD m BY DATABASE PROCEDURE …).
 */

export interface MethodBlock {
  name: string;
  /** Enclosing CLASS … IMPLEMENTATION (upper case), when the block sits inside one. */
  className?: string;
  startLine: number;   // 1-based, the METHOD line
  endLine: number;     // 1-based, the ENDMETHOD line
  text: string;
  amdp: boolean;
}

const isComment = (line: string) => /^\*/.test(line) || /^\s*"/.test(line);
const METHOD_RE = /^\s*METHOD\s+([\w~\/]+)\s*(?:\.|\s+BY\s+(DATABASE|KERNEL)\b)/i;
const END_RE = /^\s*ENDMETHOD\s*\./i;
const CLASS_IMPL_RE = /^\s*CLASS\s+([\w\/]+)\s+IMPLEMENTATION\s*\./i;
const ENDCLASS_RE = /^\s*ENDCLASS\s*\./i;

export function listMethods(source: string): MethodBlock[] {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MethodBlock[] = [];
  let open: { name: string; start: number; amdp: boolean } | undefined;
  let currentClass: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isComment(line)) continue;
    if (!open) {
      const c = line.match(CLASS_IMPL_RE);
      if (c) { currentClass = c[1].toUpperCase(); continue; }
      if (ENDCLASS_RE.test(line)) { currentClass = undefined; continue; }
      const m = line.match(METHOD_RE);
      if (m) open = { name: m[1].toUpperCase(), start: i, amdp: !!m[2] };
      continue;
    }
    if (END_RE.test(line)) {
      blocks.push({ name: open.name, className: currentClass, startLine: open.start + 1, endLine: i + 1, text: lines.slice(open.start, i + 1).join('\n'), amdp: open.amdp });
      open = undefined;
    }
  }
  return blocks;
}

/** Every block with that method name, optionally restricted to one enclosing class (local/test classes reuse method names). */
export function findMethods(source: string, methodName: string, className?: string): MethodBlock[] {
  const wanted = methodName.toUpperCase();
  const cls = className ? className.toUpperCase() : undefined;
  return listMethods(source).filter(b => b.name === wanted && (!cls || b.className === cls));
}

/** First matching block; use findMethods when the include may hold several classes. */
export function findMethod(source: string, methodName: string, className?: string): MethodBlock | undefined {
  return findMethods(source, methodName, className)[0];
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

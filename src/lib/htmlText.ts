/**
 * Remove every HTML tag, repeating until the string stops changing. One pass
 * is not enough: "<scr<script>ipt>" turns into "<script>" when the inner tag
 * is removed, and "</script >" escapes an anchored pattern. Only sequences
 * that look like tags are removed, so "a < b" and "IF x > 0" survive.
 */
export function stripTags(text: string): string {
  let s = String(text ?? '');
  for (let i = 0; i < 10; i++) {
    const next = s
      // Declarations and processing instructions: <!DOCTYPE …>, <![CDATA[…]]>,
      // <?xml …?>. They open with a punctuation character, not a name.
      .replace(/<[!?][^>]*>/g, '')
      // Elements: the name has to look like a name, so "a < b" is left alone.
      .replace(/<\/?[a-zA-Z][a-zA-Z0-9:._-]*(\s[^>]*)?\/?>/g, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Plain text from an HTML document (ABAP keyword documentation, ATC docs): block tags become line breaks, entities are decoded, scripts and styles dropped. */
export function htmlToText(html: string): string {
  let s = String(html || '');
  // Each removal runs until the string stops changing. A single pass leaves
  // markup behind when tags are nested or split: "<scr<script>ipt>" becomes
  // "<script>" after one replacement, and a closing tag written "</script >"
  // escapes an anchored pattern. Looping is what makes the output inert
  // whatever the caller does with it.
  const until = (re: RegExp, to: string) => {
    for (let i = 0; i < 10; i++) {
      const next = s.replace(re, to);
      if (next === s) return;
      s = next;
    }
  };
  until(/<head\b[\s\S]*?<\/\s*head\s*>/gi, '');
  until(/<(script|style)\b[\s\S]*?<\/\s*\1\s*>/gi, '');
  // An unclosed script or style would otherwise survive as visible source.
  until(/<(script|style)\b[\s\S]*$/gi, '');
  until(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6]|pre|table|dt|dd|blockquote|section|article)\s*>/gi, '\n');
  s = s.replace(/<\s*(li)\b[^>]*>/gi, '- ');
  s = s.replace(/<\s*(td|th)\b[^>]*>/gi, ' ');
  // Only real tags: an angle bracket followed by a name. This leaves prose and
  // ABAP snippets such as "a < b" or "IF x > 0" intact, which a blanket
  // /<[^>]*>/ would eat.
  s = stripTags(s);
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', middot: '·', bull: '•', rarr: '→', larr: '←' };
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const k = String(e);
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return entities[k.toLowerCase()] ?? m;
  });
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

/** Strip the navigation chrome the ABAP keyword documentation pages carry at the top (version selector, feedback links, copyright). */
export function stripAbapDocChrome(text: string): string {
  const lines = text.split('\n');
  const chrome = /^(ABAP Keyword Documentation|Select ?Version.*|Standard ABAP|ABAP Cloud|Mail Feedback|Open in Browser|AS ABAP Release .*rights reserved\.?|ABAP Programming Language|)$/i;
  let i = 0;
  while (i < lines.length && i < 20 && chrome.test(lines[i].trim())) i++;
  return lines.slice(i).join('\n').trim();
}

/** Plain text from an HTML document (ABAP keyword documentation, ATC docs): block tags become line breaks, entities are decoded, scripts and styles dropped. */
export function htmlToText(html: string): string {
  let s = String(html || '');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6]|pre|table|dt|dd|blockquote|section|article)\s*>/gi, '\n');
  s = s.replace(/<\s*(li)\b[^>]*>/gi, '- ');
  s = s.replace(/<\s*(td|th)\b[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
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

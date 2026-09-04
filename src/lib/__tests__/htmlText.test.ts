import { htmlToText, stripTags, stripAbapDocChrome } from '../htmlText';

describe('htmlToText', () => {
  it('drops scripts and styles, keeps block breaks and decodes entities', () => {
    const html = '<html><head><title>SELECT | ABAP Keyword Documentation</title><style>p{}</style><script>x()</script></head><body><h1>SELECT</h1><p>Reads &lt;rows&gt; &amp; more.</p><ul><li>one</li><li>two</li></ul><pre>SELECT * FROM t.</pre></body></html>';
    const text = htmlToText(html);
    expect(text).not.toMatch(/x\(\)|p\{\}|Keyword Documentation|<\/?(p|h1|ul|li|pre)>/);
    expect(text).toContain('Reads <rows> & more.');
    expect(text).toContain('- one\n- two');
    expect(text.split('\n')[0]).toContain('SELECT');
  });

  it('removes the keyword documentation chrome and decodes symbol entities', () => {
    const text = stripAbapDocChrome('ABAP Keyword Documentation\n\nSelect VersionStandard ABAPABAP Cloud\nMail Feedback\nOpen in Browser\n\nStandard ABAP\n\nAS ABAP Release 920, ©Copyright 2026 SAP SE. All rights reserved.\n\nABAP Programming Language\nWITH, ABAP SQL Statement\nSyntax ...');
    expect(text.startsWith('WITH, ABAP SQL Statement')).toBe(true);
    expect(htmlToText('&copy; 2026 &mdash; ok')).toBe('© 2026 — ok');
  });

  it('removes tags that survive a single pass, and leaves prose that only looks like one', () => {
    // Nested and split tags: one replacement reassembles a working tag, so the
    // stripper repeats until the string stops changing.
    for (const evil of ['<scr<script>ipt>alert(1)</script>', '<<script>script>x', '<script >a</script >', '<script>unclosed', '<IMG SRC=x onerror=alert(1)>']) {
      expect(stripTags(evil)).not.toMatch(/<\/?[a-zA-Z][a-zA-Z0-9:._-]*(\s[^>]*)?\/?>/);
      expect(htmlToText(evil)).not.toMatch(/<\/?[a-zA-Z][a-zA-Z0-9:._-]*(\s[^>]*)?\/?>/);
    }
    // Comparisons in prose and in ABAP are not markup and must survive.
    expect(stripTags('a < b and c > d')).toBe('a < b and c > d');
    expect(htmlToText('IF sy-subrc < 4 AND lv_x > 0.')).toBe('IF sy-subrc < 4 AND lv_x > 0.');
    expect(stripTags('<p>kept</p>')).toBe('kept');
    // Declarations and processing instructions open with punctuation, not a
    // name, so they need their own pattern; a live ABAP documentation page
    // starts with a DOCTYPE and it leaked once this was tightened.
    expect(stripTags('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "x.dtd">ok')).toBe('ok');
    expect(stripTags('<?xml version="1.0"?>ok')).toBe('ok');
    expect(stripTags('<![CDATA[x]]>ok')).toBe('ok');
  });
});

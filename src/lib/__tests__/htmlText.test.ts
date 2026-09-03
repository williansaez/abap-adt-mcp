import { htmlToText, stripAbapDocChrome } from '../htmlText';

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
});

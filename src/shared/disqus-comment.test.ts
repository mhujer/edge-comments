import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderComment, sanitizeCommentHtml } from './comment-renderer';
import { convertDisqusComment, convertDisqusHtml } from './disqus-comment';

describe('convertDisqusHtml', () => {
  it('escapes literal Markdown while leaving legacy backticks and mentions verbatim', () => {
    const bodyMd = convertDisqusHtml(
      '<p>*Request and *literal* _text_ \\path `composer test` @user:disqus</p><p>&gt; literal quote marker</p>',
    );

    expect(bodyMd).toBe(
      '\\*Request and \\*literal\\* \\_text\\_ \\\\path `composer test` @user:disqus\n\n\\> literal quote marker',
    );
    expect(renderComment(bodyMd)).toBe(
      '<p>*Request and *literal* _text_ \\path <code>composer test</code> @user:disqus</p>\n<p>&gt; literal quote marker</p>\n',
    );
  });

  it('preserves paragraphs and line breaks and decodes entities', () => {
    expect(
      convertDisqusHtml(
        '<p> One &amp; two<br>three</p>\n<p>Čtyři &lt; five</p>',
      ),
    ).toBe('One & two\nthree\n\nČtyři \\< five');
  });

  it('keeps entity-encoded tags and link-shaped text literal', () => {
    const html = '<p>&lt;tag data="some_value"&gt; [some_*value](manual)</p>';
    expect(convertDisqusComment(html).bodyHtml).toBe(
      '<p>&lt;tag data="some_value"&gt; [some_*value](manual)</p>\n',
    );
  });

  it('keeps plain tilde fences literal', () => {
    expect(convertDisqusComment('<p>~~~<br>text<br>~~~</p>').bodyHtml).toBe(
      '<p>~~~<br />\ntext<br />\n~~~</p>\n',
    );
  });

  it.each([
    [
      'truncated links and images',
      '<p><a href="https://example.com/full_path?x=1&amp;y=2" target="_blank">https://example.com/f...</a> and <img src="https://example.com/diagram.png" alt="diagram"></p>',
      'https://example.com/full_path?x=1&y=2 and https://example.com/diagram.png',
    ],
    [
      'quotes, bold, and emphasis',
      '<blockquote><p>A <b>bold</b> and <i>italic</i> line<br>next</p><p><strong>More</strong> <em>text</em></p></blockquote>',
      '> A **bold** and *italic* line\n> next\n>\n> **More** *text*',
    ],
    [
      'text under unknown tags',
      '<p>A <del>past <span>detail</span></del> and /--code</p>',
      'A past detail and /--code',
    ],
  ])('converts %s', (_name, html, bodyMd) => {
    expect(convertDisqusHtml(html)).toBe(bodyMd);
  });

  it.each([
    [
      'multiline code with breaks, blank lines, and indentation',
      '<p>Before<br><code>if (ready) {<br>  run();<br><br>  finish();<br>}</code><br>After</p>',
      'Before\n\n```\nif (ready) {\n  run();\n\n  finish();\n}\n```\n\nAfter',
      '<p>Before</p>\n<pre><code>if (ready) {\n  run();\n\n  finish();\n}\n</code></pre>\n<p>After</p>\n',
    ],
    [
      'preformatted code containing backticks and entities',
      '<pre><code><br>  ``` &lt;example&gt;<br></code></pre>',
      '````\n\n  ``` <example>\n````',
      '<pre><code>\n  ``` &lt;example&gt;\n</code></pre>\n',
    ],
    [
      'inline HTML code and legacy code containing Markdown punctuation',
      '<p>See <code>`&lt;name&gt;`</code> with `some_value`.</p>',
      'See `` `<name>` `` with `some_value`.',
      '<p>See <code>`&lt;name&gt;`</code> with <code>some_value</code>.</p>\n',
    ],
  ])('preserves %s', (_name, html, bodyMd, bodyHtml) => {
    expect(convertDisqusHtml(html)).toBe(bodyMd);
    expect(renderComment(bodyMd)).toBe(bodyHtml);
  });
});

describe('convertDisqusComment', () => {
  it('reports no differences after normalizing aliases, link labels, whitespace, and code breaks', () => {
    const html =
      '<p> <b>Bold</b>   <i>italic</i><br><a href="https://example.com/long">https://example.com/l...</a> </p>' +
      '<pre><code>run();<br>  next();</code></pre>';

    const result = convertDisqusComment(html);
    expect(result.bodyHtml).toContain(
      '<a href="https://example.com/long" rel="nofollow ugc noopener">https://example.com/long</a>',
    );
    expect(result.fidelityDiffs).toEqual([]);
  });

  it('reports only the tag mismatch when stripping unknown markup leaves the text intact', () => {
    expect(
      convertDisqusComment('<p>Look at <s>this</s></p>').fidelityDiffs,
    ).toEqual([
      {
        field: 'tags',
        original: '<p> <s> </s> </p>',
        rendered: '<p> </p>',
        diff: '- "<p> <s> </s> </p>"\n+ "<p> </p>"',
      },
    ]);
  });

  it('reports the text and tag mismatches when legacy text becomes inline code', () => {
    const { fidelityDiffs } = convertDisqusComment('<p>Run `build`</p>');
    expect(fidelityDiffs).toEqual([
      {
        field: 'text',
        original: 'Run `build`',
        rendered: 'Run build',
        diff: '- "Run `build`"\n+ "Run build"',
      },
      {
        field: 'tags',
        original: '<p> </p>',
        rendered: '<p> <code> </code> </p>',
        diff: '- "<p> </p>"\n+ "<p> <code> </code> </p>"',
      },
    ]);
  });

  it('produces allowlisted HTML with HTTP(S) links that survives sanitizing again', () => {
    const escapeHtml = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    const text = fc.string({ unit: 'binary', maxLength: 32 }).map(escapeHtml);
    const destination = fc.oneof(
      text,
      fc.constantFrom(
        'https://example.com/a?x=1&amp;y=2',
        'http://example.com/a_(b)',
        '//example.com',
        'javascript:example',
        'jav&#x61;script:example',
        'data:text/html,example',
      ),
    );
    const inline = fc.oneof(
      text,
      fc.constantFrom('<br>', '`legacy_code`', '&lt;tag&gt;'),
      fc
        .tuple(fc.constantFrom('i', 'b', 'code', 'unknown'), text)
        .map(([tag, value]) => `<${tag}>${value}</${tag}>`),
      fc
        .tuple(destination, text)
        .map(
          ([href, label]) => `<a href="${href}" target="_blank">${label}</a>`,
        ),
      destination.map((src) => `<img src="${src}" title="example">`),
    );
    const paragraph = fc
      .array(inline, { minLength: 1, maxLength: 6 })
      .map((parts) => `<p>${parts.join(' ')}</p>`);
    const code = fc
      .array(text, { minLength: 1, maxLength: 4 })
      .map((lines) => `<pre><code>${lines.join('<br>')}</code></pre>`);
    const html = fc
      .array(
        fc.oneof(
          paragraph,
          code,
          paragraph.map((p) => `<blockquote>${p}</blockquote>`),
        ),
        { maxLength: 6 },
      )
      .map((blocks) => blocks.join(''));
    const allowedTag =
      /^(?:<\/?(?:p|pre|blockquote|strong|em)>|<br \/>|<\/a>|<a href="[^"]+" rel="nofollow ugc noopener">|<\/code>|<code(?: class="language-[^\s"]+")?>)$/;

    fc.assert(
      fc.property(html, (input) => {
        const { bodyHtml } = convertDisqusComment(input);
        const tag = /<[^>]*>/g;
        expect(bodyHtml.replace(tag, '')).not.toContain('<');
        for (const [element] of bodyHtml.matchAll(tag))
          expect(element).toMatch(allowedTag);
        for (const [, href] of bodyHtml.matchAll(/<a href="([^"]+)"/g)) {
          expect(href).toMatch(/^https?:\/\//i);
          expect(['http:', 'https:']).toContain(new URL(href).protocol);
        }
        expect(sanitizeCommentHtml(bodyHtml)).toBe(bodyHtml);
      }),
      { numRuns: 500 },
    );
  });
});

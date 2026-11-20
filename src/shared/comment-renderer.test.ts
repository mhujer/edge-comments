import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateCommentBody } from './comment-input';
import { renderComment, sanitizeCommentHtml } from './comment-renderer';

describe('renderComment', () => {
  it.each([
    [
      'paragraphs, line breaks and inline formatting',
      'First line\n**bold**, *italic*, _italic_, snake_case, `code`\n\nNext',
      '<p>First line<br />\n<strong>bold</strong>, <em>italic</em>, <em>italic</em>, snake_case, <code>code</code></p>\n<p>Next</p>\n',
    ],
    [
      'a blockquote and a fenced code block with a language tag',
      '> quote\n> second line\n\n```ts\nconst x = "<tag>";\n```',
      '<blockquote>\n<p>quote<br />\nsecond line</p>\n</blockquote>\n<pre><code class="language-ts">const x = "&lt;tag&gt;";\n</code></pre>\n',
    ],
    [
      'a literal Markdown link and image',
      '[text](url) [**text**](https://example.com/a(b) "title") ![**alt**](https://example.com/pic.png)',
      '<p>[text](url) [**text**](https://example.com/a(b) "title") ![**alt**](https://example.com/pic.png)</p>\n',
    ],
    [
      'literal headings, lists, and indented code',
      '# heading\n\n- list\n- list\n\n    indented code',
      '<p># heading</p>\n<p>- list<br />\n- list</p>\n<p>indented code</p>\n',
    ],
    [
      'literal raw HTML and attribute text',
      '<a href="https://example.com" onclick="alert(1)">click</a>',
      '<p>&lt;a href="https://example.com" onclick="alert(1)"&gt;click&lt;/a&gt;</p>\n',
    ],
    [
      'inert SVG and script markup',
      '<svg onload=alert(1)><script>alert(1)</script></svg>',
      '<p>&lt;svg onload=alert(1)&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;</p>\n',
    ],
    [
      'an inert entity-encoded scheme',
      'jav&#x61;script&#58;alert(1)',
      '<p>jav&amp;#x61;script&amp;#58;alert(1)</p>\n',
    ],
    [
      'inert dangerous schemes',
      'jAvAsCrIpT:alert(1), data:text/html,<script>hello</script>, vbscript:msgbox(1)',
      '<p>jAvAsCrIpT:alert(1), data:text/html,&lt;script&gt;hello&lt;/script&gt;, vbscript:msgbox(1)</p>\n',
    ],
    [
      'a malformed HTTP URL as literal text',
      'http://example.com`\u0000',
      '<p>http://example.com`�</p>\n',
    ],
    [
      'inert explicit links with unsupported schemes',
      'ftp://example.com, //example.com, mailto:person@example.com',
      '<p>ftp://example.com, //example.com, mailto:person@example.com</p>\n',
    ],
    [
      'HTTP links and escaped query parameters',
      'HTTP://example.com and https://example.com/path?q=a&x=b',
      '<p><a href="HTTP://example.com" rel="nofollow ugc noopener">HTTP://example.com</a> and <a href="https://example.com/path?q=a&amp;x=b" rel="nofollow ugc noopener">https://example.com/path?q=a&amp;x=b</a></p>\n',
    ],
    [
      'punctuation outside anchors and HTTPS for www links',
      'Visit (https://example.com/a(b)?!); then www.example.com/test:',
      '<p>Visit (<a href="https://example.com/a(b)" rel="nofollow ugc noopener">https://example.com/a(b)</a>?!); then <a href="https://www.example.com/test" rel="nofollow ugc noopener">www.example.com/test</a>:</p>\n',
    ],
  ])('renders %s', (_name, input, output) => {
    expect(renderComment(input)).toBe(output);
  });

  it('produces only allowlisted HTML and absolute HTTP(S) links over arbitrary input', () => {
    const unicode = fc.string({ unit: 'binary' });
    const markdownPieces = fc.array(
      fc.oneof(
        unicode,
        fc.constantFrom(
          '\n> ',
          '\n```ts\n',
          '`',
          '*',
          '_',
          '[x](',
          '"',
          '<script>',
          '&lt;',
        ),
        fc.constantFrom(
          'http://example.com',
          'https://example.com/a?b=c&d=e',
          'www.example.com?',
        ),
      ),
    );
    const input = fc.oneof(
      unicode,
      markdownPieces.map((pieces) => pieces.join('')),
    );
    const tag = /<[^>]*>/g;
    const allowedTag =
      /^(?:<\/?(?:p|pre|blockquote|strong|em)>|<br \/>|<\/a>|<a href="[^"]+" rel="nofollow ugc noopener">|<\/code>|<code(?: class="language-[^\s"]+")?>)$/;

    fc.assert(
      fc.property(input, (body) => {
        const html = renderComment(body);
        expect(html.replace(tag, '')).not.toContain('<');
        for (const [element] of html.matchAll(tag)) {
          expect(element).toMatch(allowedTag);
        }
        for (const [, href] of html.matchAll(/<a href="([^"]+)"/g)) {
          expect(href).toMatch(/^https?:\/\//i);
          expect(['http:', 'https:']).toContain(new URL(href).protocol);
        }
        expect(sanitizeCommentHtml(html)).toBe(html);
      }),
      { numRuns: 500 },
    );
  });
});

describe('sanitizeCommentHtml', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'vbscript:msgbox(1)',
    'jAvAsCrIpT:alert(1)',
    'jav&#x61;script&#58;alert(1)',
    'java%73cript%3aalert(1)',
    ' \tjavascript:alert(1)',
    'java&#x09;script:alert(1)',
    '//example.com',
    '/relative',
  ])('removes the anchor with href %j and preserves its content', (href) => {
    expect(
      sanitizeCommentHtml(`<a href="${href}"><strong>link</strong></a>`),
    ).toBe('<strong>link</strong>');
  });

  it('removes tags and attributes outside the allowlist', () => {
    expect(
      sanitizeCommentHtml(
        '<p onclick="alert(1)"><script>alert(1)</script><img src="x"><a href="https://example.com" rel="nofollow ugc noopener" target="_blank">link</a><code class="danger language-ts" style="color:red">code</code></p>',
      ),
    ).toBe(
      '<p><a href="https://example.com" rel="nofollow ugc noopener">link</a><code class="language-ts">code</code></p>',
    );
  });
});

describe('validateCommentBody', () => {
  it('checks the trimmed body against both character limits', () => {
    const atLimit = '🙂'.repeat(20_000);

    expect(validateCommentBody(' \t\n ')).toEqual({
      ok: false,
      code: 'body_empty',
    });
    expect(validateCommentBody(' x\n')).toEqual({ ok: true, body: 'x' });
    expect(validateCommentBody(`\n${atLimit}  `)).toEqual({
      ok: true,
      body: atLimit,
    });
    expect(validateCommentBody(`${atLimit}x`)).toEqual({
      ok: false,
      code: 'body_too_long',
    });
    expect(validateCommentBody('a'.repeat(20_001))).toEqual({
      ok: false,
      code: 'body_too_long',
    });
  });
});

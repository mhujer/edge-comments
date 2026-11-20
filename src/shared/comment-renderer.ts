import MarkdownIt, { type StateInline } from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

export const COMMENT_RENDERER_VERSION = 2;

const LINK_REL = 'nofollow ugc noopener';
const HTTP_URL = /^https?:\/\//i;

function isHttpUrl(url: string): boolean {
  return HTTP_URL.test(url) && URL.canParse(url);
}

const markdown = new MarkdownIt('zero', {
  html: false,
  breaks: true,
  linkify: true,
}).enable([
  'newline',
  'escape',
  'backticks',
  'fence',
  'blockquote',
  'emphasis',
  'linkify',
]);

markdown.validateLink = isHttpUrl;
markdown.linkify.set({ fuzzyEmail: false, fuzzyLink: true });

const normalizeLink = markdown.linkify.normalize.bind(markdown.linkify);
markdown.linkify.normalize = (match) => {
  // Shorten the match itself so the renderer keeps sentence punctuation outside the anchor.
  const linkedText = match.raw.replace(/[.,!?;:]+$/, '');
  match.lastIndex -= match.raw.length - linkedText.length;
  match.text = match.url = linkedText;
  normalizeLink(match);
  if (!match.schema && /^www\./i.test(match.raw)) {
    match.url = `https://${linkedText}`;
  }
};

const LINK_SPACE = /[\t\n ]*/y;

function skipLinkSpace(source: string, from: number): number {
  LINK_SPACE.lastIndex = from;
  LINK_SPACE.exec(source);
  return LINK_SPACE.lastIndex;
}

function literalLink(state: StateInline, silent: boolean): boolean {
  const { src, pos: start, posMax: max, md } = state;
  const labelStart = src.startsWith('![', start) ? start + 1 : start;
  if (src[labelStart] !== '[' || src.lastIndexOf('](', max - 1) < labelStart)
    return false;

  const labelEnd = md.helpers.parseLinkLabel(state, labelStart);
  if (labelEnd < 0 || src[labelEnd + 1] !== '(') return false;

  const destinationStart = skipLinkSpace(src, labelEnd + 2);
  const destination = md.helpers.parseLinkDestination(
    src,
    destinationStart,
    max,
  );
  const destinationEnd = destination.ok ? destination.pos : destinationStart;
  let end = skipLinkSpace(src, destinationEnd);
  if (end > destinationEnd && src[end] !== ')') {
    const title = md.helpers.parseLinkTitle(src, end, max);
    if (!title.ok) return false;
    end = skipLinkSpace(src, title.pos);
  }
  if (end >= max || src[end] !== ')') return false;

  // Keep unsupported syntax in a separate token so linkify ignores URLs within it.
  if (!silent)
    state.push('text_special', '', 0).content = src.slice(start, end + 1);
  state.pos = end + 1;
  return true;
}

markdown.inline.ruler.before('linkify', 'literal_link', literalLink);

const HTML_TAG =
  /<![a-z]+[^<>]*>|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/iy;

markdown.inline.ruler.before('linkify', 'literal_html', (state, silent) => {
  if (state.src[state.pos] !== '<') return false;
  let end: number;
  if (state.src.startsWith('<!--', state.pos)) {
    const close = state.src.indexOf('-->', state.pos + 4);
    if (close < 0) return false;
    end = close + 3;
  } else {
    HTML_TAG.lastIndex = state.pos;
    if (!HTML_TAG.test(state.src)) return false;
    end = HTML_TAG.lastIndex;
  }
  if (end > state.posMax) return false;

  if (!silent)
    state.push('text_special', '', 0).content = state.src.slice(state.pos, end);
  state.pos = end;
  return true;
});

markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  _env,
  renderer,
) => {
  tokens[index].attrSet('rel', LINK_REL);
  return renderer.renderToken(tokens, index, options);
};

/** Apply the Comment HTML allowlist, independent of the Markdown parser. */
export function sanitizeCommentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'a', 'code', 'pre', 'blockquote', 'strong', 'em'],
    allowedAttributes: { a: ['href', { name: 'rel', values: [LINK_REL] }] },
    allowedClasses: { code: [/^language-\S+$/] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    exclusiveFilter: (frame) => {
      if (frame.tag === 'a' && !isHttpUrl(frame.attribs.href ?? ''))
        return 'excludeTag';
      return false;
    },
  });
}

/** Render a Comment's Markdown for use by the Worker and import tooling. */
export function renderComment(bodyMd: string): string {
  return sanitizeCommentHtml(markdown.render(bodyMd));
}

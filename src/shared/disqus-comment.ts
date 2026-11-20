import { ElementType, parseDocument } from 'htmlparser2';
import { renderComment } from './comment-renderer';

type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
type HtmlElement = Extract<HtmlNode, { children: HtmlNode[]; name: string }>;

interface MarkdownPart {
  markdown: string;
  block?: true;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return ElementType.isTag(node);
}

function escapeMarkdownText(text: string): string {
  // Leave legacy backtick spans intact, including punctuation within them.
  const parts = text.replace(/[ \t\r\n\f]+/g, ' ').split(/(`+)/);
  let markdown = '';
  for (let index = 0; index < parts.length; index += 2) {
    markdown += parts[index].replace(/[\\*_~<>[\]]/g, '\\$&');
    const marker = parts[index + 1];
    if (!marker) break;
    const close = parts.indexOf(marker, index + 2);
    if (close === -1) {
      markdown += marker;
      continue;
    }
    markdown += parts.slice(index + 1, close + 1).join('');
    index = close - 1;
  }
  return markdown;
}

function emphasis(parts: MarkdownPart[], marker: string): MarkdownPart[] {
  if (parts.some((part) => part.block)) return parts;
  const markdown = parts.map((part) => part.markdown).join('');
  const content = markdown.trim();
  if (!content) return parts;
  const before = markdown.slice(
    0,
    markdown.length - markdown.trimStart().length,
  );
  const after = markdown.slice(markdown.trimEnd().length);
  return [{ markdown: `${before}${marker}${content}${marker}${after}` }];
}

function preformattedText(nodes: HtmlNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === ElementType.Text)
        return node.data.replace(/\r\n?/g, '\n');
      if (!isElement(node)) return '';
      return node.name === 'br' ? '\n' : preformattedText(node.children);
    })
    .join('');
}

function codePart(text: string, block: boolean): MarkdownPart {
  const longestRun = [...text.matchAll(/`+/g)].reduce(
    (longest, [run]) => Math.max(longest, run.length),
    0,
  );
  const marker = '`'.repeat(Math.max(block ? 3 : 1, longestRun + 1));
  if (block) {
    const content = text && !text.endsWith('\n') ? `${text}\n` : text;
    return { markdown: `${marker}\n${content}${marker}`, block: true };
  }
  if (!text) return { markdown: '' };
  const needsPadding =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text));
  const padding = needsPadding ? ' ' : '';
  return { markdown: `${marker}${padding}${text}${padding}${marker}` };
}

function markdownParts(nodes: HtmlNode[]): MarkdownPart[] {
  return nodes.flatMap((node): MarkdownPart[] => {
    if (node.type === ElementType.Text)
      return [{ markdown: escapeMarkdownText(node.data) }];
    if (!isElement(node)) return [];

    switch (node.name) {
      case 'br':
        return [{ markdown: '\n' }];
      case 'a':
        return node.attribs.href
          ? [{ markdown: node.attribs.href }]
          : markdownParts(node.children);
      case 'img':
        return [{ markdown: node.attribs.src ?? '' }];
      case 'pre':
        return [codePart(preformattedText(node.children), true)];
      case 'code': {
        const text = preformattedText(node.children);
        return [codePart(text, text.includes('\n'))];
      }
      case 'p':
        return [{ markdown: toMarkdown(node.children), block: true }];
      case 'blockquote': {
        const quoted = toMarkdown(node.children);
        const markdown = quoted
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
        return [{ markdown, block: true }];
      }
      case 'b':
      case 'strong':
        return emphasis(markdownParts(node.children), '**');
      case 'i':
      case 'em':
        return emphasis(markdownParts(node.children), '*');
      default:
        return markdownParts(node.children);
    }
  });
}

function toMarkdown(nodes: HtmlNode[]): string {
  const paragraphs: string[] = [];
  let inline = '';
  for (const part of markdownParts(nodes)) {
    if (!part.block) {
      inline += part.markdown;
      continue;
    }
    if (inline.trim()) paragraphs.push(inline.trim());
    if (part.markdown) paragraphs.push(part.markdown);
    inline = '';
  }
  if (inline.trim()) paragraphs.push(inline.trim());
  return paragraphs.join('\n\n');
}

export function convertDisqusHtml(html: string): string {
  return toMarkdown(parseDocument(html).children);
}

export interface DisqusFidelityDiff {
  field: 'text' | 'tags';
  original: string;
  rendered: string;
  diff: string;
}

const BLOCK_TAGS = new Set(['p', 'pre', 'blockquote']);
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function normalize(
  nodes: HtmlNode[],
): Record<DisqusFidelityDiff['field'], string> {
  const text: string[] = [];
  const tags: string[] = [];

  function visit(node: HtmlNode, inCode: boolean, includeText: boolean): void {
    if (node.type === ElementType.Text) {
      if (includeText) text.push(node.data);
      return;
    }
    if (!isElement(node)) return;

    const tag =
      node.name === 'i' ? 'em' : node.name === 'b' ? 'strong' : node.name;
    if (tag === 'br' && inCode) {
      if (includeText) text.push('\n');
      return;
    }
    tags.push(`<${tag}>`);
    if (includeText && (tag === 'br' || BLOCK_TAGS.has(tag))) text.push(' ');
    const href = tag === 'a' && node.attribs.href;
    if (href && includeText) text.push(href);
    for (const child of node.children) {
      visit(
        child,
        inCode || tag === 'pre' || tag === 'code',
        includeText && !href,
      );
    }
    if (!VOID_TAGS.has(tag)) tags.push(`</${tag}>`);
    if (includeText && BLOCK_TAGS.has(tag)) text.push(' ');
  }

  for (const node of nodes) visit(node, false, true);
  return {
    text: text.join('').replace(/\s+/g, ' ').trim(),
    tags: tags.join(' '),
  };
}

/** Convert an exported Comment and compare its original and rendered content. */
export function convertDisqusComment(html: string): {
  bodyMd: string;
  bodyHtml: string;
  fidelityDiffs: DisqusFidelityDiff[];
} {
  const nodes = parseDocument(html).children;
  const bodyMd = toMarkdown(nodes);
  const bodyHtml = renderComment(bodyMd);
  const original = normalize(nodes);
  const rendered = normalize(parseDocument(bodyHtml).children);
  const fidelityDiffs: DisqusFidelityDiff[] = [];

  for (const field of ['text', 'tags'] as const) {
    if (original[field] === rendered[field]) continue;
    fidelityDiffs.push({
      field,
      original: original[field],
      rendered: rendered[field],
      diff: `- ${JSON.stringify(original[field])}\n+ ${JSON.stringify(rendered[field])}`,
    });
  }
  return { bodyMd, bodyHtml, fidelityDiffs };
}

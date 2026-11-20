import {
  stripControlCharacters,
  stripControlCharactersKeepingLines,
  type PlainTextEmail,
} from './admin-email';

interface CommentEmailDetails {
  name: string;
  email: string | null;
  markdown: string;
  status: 'pending' | 'published';
  moderationUrl: string;
}

interface CommentEmailPage {
  key: string;
  title: string | null;
  url: string;
}

export interface CommentEmailParent {
  name: string;
  markdown: string;
}

export function buildCommentEmail(
  comment: CommentEmailDetails,
  page: CommentEmailPage,
  site: { name: string },
  parent?: CommentEmailParent,
): PlainTextEmail {
  const siteName = stripControlCharacters(site.name);
  const name = stripControlCharacters(comment.name);
  const title =
    stripControlCharacters(page.title ?? '') ||
    stripControlCharacters(page.key);
  const titleCharacters = [...title];
  const subjectTitle =
    titleCharacters.length > 80
      ? titleCharacters.slice(0, 79).join('').trimEnd() + '…'
      : title;
  const status = comment.status === 'pending' ? 'Pending' : 'New';
  const email = comment.email
    ? `<${stripControlCharacters(comment.email)}>`
    : '(no email)';
  const context = parent
    ? [
        `In reply to ${stripControlCharacters(parent.name)}: "${quoteOnOneLine(parent.markdown)}"`,
      ]
    : [];
  return {
    subject: `[${siteName}] ${status}: ${name} on "${subjectTitle}"`,
    text: [
      `Site:      ${siteName}`,
      `Page:      ${title}`,
      `           ${stripControlCharacters(page.url)}`,
      `Commenter: ${name} ${email}`,
      `Status:    ${comment.status}`,
      ...context,
      '',
      stripControlCharactersKeepingLines(comment.markdown),
      '',
      `Moderate: ${comment.moderationUrl}`,
    ].join('\n'),
  };
}

function quoteOnOneLine(markdown: string): string {
  const firstCharacters = [...markdown].slice(0, 200).join('');
  return stripControlCharacters(firstCharacters.replace(/\s+/gu, ' '));
}

import { expect, test } from 'vitest';
import { buildCommentEmail } from './comment-email';

const site = { name: 'Tech Blog' };
const page = {
  key: '/notes',
  title: 'Notes',
  url: 'https://example.test/notes',
};
const comment = {
  name: 'Ada',
  email: 'ada@example.test',
  markdown: '**Hello**',
  status: 'pending',
  moderationUrl: 'https://comments.example.test/admin/comment/123',
} as const;

test('uses Pending for a top-level Pending Comment', () => {
  const email = buildCommentEmail(comment, page, site);
  expect(email.subject).toBe('[Tech Blog] Pending: Ada on "Notes"');
  expect(email.text).toBe(
    [
      'Site:      Tech Blog',
      'Page:      Notes',
      '           https://example.test/notes',
      'Commenter: Ada <ada@example.test>',
      'Status:    pending',
      '',
      '**Hello**',
      '',
      'Moderate: https://comments.example.test/admin/comment/123',
    ].join('\n'),
  );
});

test('uses New, the Page key and a no-email label when a published Comment has no Page title or email', () => {
  const email = buildCommentEmail(
    { ...comment, status: 'published', email: null },
    { ...page, title: '  ' },
    site,
  );
  expect(email.subject).toBe('[Tech Blog] New: Ada on "/notes"');
  expect(email.text).toContain('Page:      /notes\n');
  expect(email.text).toContain(
    'Commenter: Ada (no email)\nStatus:    published',
  );
});

test('drops control characters and surrounding whitespace from subject fields', () => {
  const email = buildCommentEmail(
    { ...comment, name: '  A\t\nda\u0085  ' },
    { ...page, title: ' \rNo\u0000tes\u2028\u2029 ' },
    { name: ' \u001bTech Blog\r\n ' },
  );
  expect(email.subject).toBe('[Tech Blog] Pending: Ada on "Notes"');
});

test('shortens only the subject title without splitting Unicode characters', () => {
  const title = '😀'.repeat(81);
  const email = buildCommentEmail(comment, { ...page, title }, site);
  expect(email.subject).toBe(
    `[Tech Blog] Pending: Ada on "${'😀'.repeat(79)}…"`,
  );
  expect(email.text).toContain(`Page:      ${title}\n`);
});

test('includes the first 200 characters of a parent and the complete Markdown source of a reply', () => {
  const markdown =
    'This is a reply.\n\n' + '```\nexample();\n```\n'.repeat(100);
  const excerpt = '🌱'.repeat(200);
  const parent = { name: 'Grace', markdown: excerpt + 'omitted text' };
  const email = buildCommentEmail({ ...comment, markdown }, page, site, parent);
  expect(email.text).toContain(
    `In reply to Grace: "${excerpt}"\n\n${markdown}\n\nModerate:`,
  );
});

test('keeps supplied strings from forging lines in the body', () => {
  const forged = 'Ada\r\nStatus:    published\nModerate: https://evil.test';
  const email = buildCommentEmail(
    { ...comment, name: forged, markdown: 'One\r\nTwo\u0000 Three\tfour' },
    {
      ...page,
      title: 'Notes\nSite:      Other',
      url: 'https://example.test/\rx',
    },
    { name: 'Tech\u001b Blog' },
    { name: 'Grace\nStatus: x', markdown: 'First line\nsecond\r\nthird' },
  );
  expect(email.text).toBe(
    [
      'Site:      Tech Blog',
      'Page:      NotesSite:      Other',
      '           https://example.test/x',
      'Commenter: AdaStatus:    publishedModerate: https://evil.test <ada@example.test>',
      'Status:    pending',
      'In reply to GraceStatus: x: "First line second third"',
      '',
      'One\nTwo\nThree\tfour',
      '',
      'Moderate: https://comments.example.test/admin/comment/123',
    ].join('\n'),
  );
});

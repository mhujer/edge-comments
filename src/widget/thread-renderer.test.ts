import { expect, test } from 'vitest';
import type { PublicComment } from '../shared/public-comments';
import { renderThreadList } from './thread-renderer';
import { widgetStrings } from './strings';

const now = Date.UTC(2026, 9, 21, 12);
const en = widgetStrings('en', now);

function comment(
  id: string,
  day: number,
  parentId: string | null = null,
): PublicComment {
  return {
    id,
    parentId,
    name: id,
    html: `<p>Body by ${id}</p>`,
    createdAt: new Date(Date.UTC(2026, 9, day, 12)).toISOString(),
  };
}

test('lists newest Threads first and siblings oldest first', () => {
  const { count, threads: html } = renderThreadList(
    [
      comment('Older root', 11),
      comment('Later reply', 15, 'Older root'),
      comment('Earlier reply', 13, 'Older root'),
      comment('Newer root', 12),
    ],
    en,
  );
  expect(
    [...html.matchAll(/<p>Body by (.*?)<\/p>/g)].map((match) => match[1]),
  ).toEqual(['Newer root', 'Older root', 'Earlier reply', 'Later reply']);
  expect(count).toBe(4);
});

test('caps display depth at level three and references each original parent', () => {
  const { threads: html } = renderThreadList(
    [
      comment('Root', 1),
      comment('Second', 2, 'Root'),
      comment('Third', 3, 'Second'),
      comment('Another third', 4, 'Second'),
      comment('Deep', 5, 'Third'),
      comment('Deepest', 6, 'Deep'),
    ],
    en,
  );
  expect(
    [...html.matchAll(/<p>Body by (.*?)<\/p>/g)].map((match) => match[1]),
  ).toEqual(['Root', 'Second', 'Third', 'Another third', 'Deep', 'Deepest']);
  expect(
    [...html.matchAll(/edge-comments-depth-\d/g)].map((match) => match[0]),
  ).toEqual([
    'edge-comments-depth-1',
    'edge-comments-depth-2',
    'edge-comments-depth-3',
    'edge-comments-depth-3',
    'edge-comments-depth-3',
    'edge-comments-depth-3',
  ]);
  expect(html).toContain('↪ in reply to Third');
  expect(html).toContain('↪ in reply to Deep');
  expect(html).toContain(
    'data-edge-comments-parent="edge-comments-comment-Third"',
  );
  expect(html).toContain(
    'data-edge-comments-parent="edge-comments-comment-Deep"',
  );
});

test('shows a removed ancestor without including it in the count', () => {
  const { count, threads: html } = renderThreadList(
    [
      {
        id: 'Removed',
        parentId: null,
        createdAt: '2026-10-17T12:00:00.000Z',
        removed: true,
      },
      comment('Visible reply', 18, 'Removed'),
    ],
    en,
  );
  expect(count).toBe(1);
  expect(html).toContain('Comment removed');
  expect(html).toContain('Body by Visible reply');
});

test('escapes names, identifiers and link labels, and retains rendered HTML', () => {
  const name = '<img src=x> & "quoted"';
  const { threads: html } = renderThreadList(
    [
      comment('Root', 1),
      comment('Second', 2, 'Root'),
      {
        ...comment('third"parent', 3, 'Second'),
        name,
        html: '<p><code>a &amp; b</code></p>',
      },
      comment('Deep', 4, 'third"parent'),
    ],
    en,
  );
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img src=x&gt; &amp; &quot;quoted&quot;');
  expect(html).toContain(
    '↪ in reply to &lt;img src=x&gt; &amp; &quot;quoted&quot;',
  );
  expect(html).toContain(
    'data-edge-comments-parent="edge-comments-comment-third&quot;parent"',
  );
  expect(html).toContain('<p><code>a &amp; b</code></p>');
});

test('renders a localized relative date with a full date tooltip', () => {
  const { threads: html } = renderThreadList([comment('Ada', 18)], en);
  expect(html).toMatch(
    /<time datetime="2026-10-18T12:00:00\.000Z" title="Sunday, October 18, 2026[^"]*">3 days ago<\/time>/,
  );
});

test.each([
  [0, '0 comments'],
  [1, '1 comment'],
  [4, '4 comments'],
])('uses the English plural for %s', (count, label) => {
  expect(en.count(count)).toBe(label);
});

test.each([
  [0, '0 komentářů'],
  [1, '1 komentář'],
  [2, '2 komentáře'],
  [4, '4 komentáře'],
  [5, '5 komentářů'],
  [21, '21 komentářů'],
])('uses the Czech plural for %s', (count, label) => {
  expect(widgetStrings('cs', now).count(count)).toBe(label);
});

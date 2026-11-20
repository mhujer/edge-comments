import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { createSiteSql, parseFirstSite } from './create-site';

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  return db;
}

const fields = {
  name: " Martin's Blog ",
  defaultLanguage: 'en',
  moderationMode: 'approve_first',
  origins:
    'https://BLOG.example.com/\nhttp://localhost:8080\nhttps://blog.example.com',
};

test('the generated SQL creates the first Site with its Allowed origins', () => {
  const settings = parseFirstSite(fields);
  if (typeof settings === 'string') throw new Error(settings);
  const db = migratedDatabase();
  try {
    db.exec(createSiteSql(settings));

    const sites = db
      .prepare(
        'SELECT id, name, default_language, moderation_mode, created_at, updated_at FROM site',
      )
      .all();
    expect(sites).toHaveLength(1);
    const [{ id, created_at, updated_at, ...site }] = sites as [
      Record<string, string>,
    ];
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7/);
    expect(created_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(updated_at).toBe(created_at);
    expect(site).toEqual({
      name: "Martin's Blog",
      default_language: 'en',
      moderation_mode: 'approve_first',
    });
    expect(
      db
        .prepare('SELECT site_id, origin FROM site_origin ORDER BY origin')
        .all(),
    ).toEqual([
      { site_id: id, origin: 'http://localhost:8080' },
      { site_id: id, origin: 'https://blog.example.com' },
    ]);
  } finally {
    db.close();
  }
});

test('the generated SQL creates nothing once the database has a Site', () => {
  const db = migratedDatabase();
  try {
    const first = parseFirstSite(fields);
    const second = parseFirstSite({
      ...fields,
      name: 'Other',
      origins: 'https://other.example',
    });
    if (typeof first === 'string' || typeof second === 'string')
      throw new Error('Invalid fixture.');
    db.exec(createSiteSql(first));
    db.exec(createSiteSql(second));

    expect(db.prepare('SELECT name FROM site').all()).toEqual([
      { name: "Martin's Blog" },
    ]);
    expect(db.prepare('SELECT origin FROM site_origin').all()).toHaveLength(2);
  } finally {
    db.close();
  }
});

test.each([
  [{ name: '  ' }, 'Enter a Site name.'],
  [{ defaultLanguage: 'de' }, 'Choose a default language.'],
  [{ moderationMode: 'never' }, 'Choose a moderation mode.'],
  [
    { origins: 'https://blog.example.com/posts' },
    '“https://blog.example.com/posts” is an invalid Allowed origin. Use scheme://host[:port] with no path.',
  ],
  [{ origins: ' \n ' }, 'Enter at least one Allowed origin.'],
  [
    {
      origins: Array.from(
        { length: 11 },
        (_, index) => `https://site${index}.example`,
      ).join('\n'),
    },
    'Turnstile allows at most 10 distinct hostnames across all Sites. Use fewer Allowed origins.',
  ],
])('rejects invalid first Site fields %o', (change, error) => {
  expect(parseFirstSite({ ...fields, ...change })).toBe(error);
});

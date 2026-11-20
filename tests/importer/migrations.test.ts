import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

test('generated migrations prepare SQLite for importer output', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const file of readdirSync('migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    }
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: 'comment' },
      { name: 'page' },
      { name: 'site' },
      { name: 'site_origin' },
    ]);
    expect(() =>
      db
        .prepare(
          'INSERT INTO site_origin (id, site_id, origin) VALUES (?, ?, ?)',
        )
        .run(
          '01941f29-7c00-73e4-a310-744d2167fc5a',
          '01941f29-7c00-73e4-a310-744d2167fc5b',
          'https://example.com',
        ),
    ).toThrow(/FOREIGN KEY/);
  } finally {
    db.close();
  }
});

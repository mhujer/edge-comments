import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vitest';
import {
  importSql,
  planDisqusImport,
  readImportState,
  verifyImport,
} from '../../src/cli/disqus-import';

const xml = readFileSync('tests/fixtures/disqus.xml', 'utf8');
const siteId = '01941f29-7c00-73e4-a310-744d2167fc5b';
const pageId = '01941f29-7c00-73e4-a310-744d2167fc5c';
const createdAt = '2020-01-01T12:00:00.000Z';

test('reports and applies a repeatable Disqus import to a migrated database', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of readdirSync('migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(`migrations/${name}`, 'utf8'));
    }
    db.prepare(
      "INSERT INTO site (id, name, default_language, created_at, updated_at) VALUES (?, 'Blog', 'en', ?, ?)",
    ).run(siteId, createdAt, createdAt);
    db.prepare(
      "INSERT INTO site_origin (id, site_id, origin) VALUES ('01941f29-7c00-73e4-a310-744d2167fc5a', ?, 'https://blog.example')",
    ).run(siteId);
    db.prepare(
      "INSERT INTO page (id, site_id, key, url, title, created_at, updated_at) VALUES (?, ?, '/notes', 'https://blog.example/notes/', 'Admin title', ?, ?)",
    ).run(pageId, siteId, createdAt, createdAt);
    const query = async <Row>(sql: string) =>
      await Promise.resolve(db.prepare(sql).all() as Row[]);
    const fetchTitle = vi.fn<typeof fetch>(
      async (url) =>
        await Promise.resolve(
          url === 'https://blog.example/removed/'
            ? new Response(null, { status: 404 })
            : new Response('<title>Live Notes &amp; ideas</title>'),
        ),
    );
    const state = await readImportState(query, siteId);
    const plan = await planDisqusImport(xml, state, fetchTitle);

    expect(plan.report).toMatchObject({
      counts: {
        threads: 8,
        newPages: 1,
        reusedPages: 1,
        commentsToInsert: 8,
        alreadyImported: 0,
        skippedSpamOrDeleted: 2,
        published: 7,
        rejected: 1,
      },
      skippedHosts: [
        { host: 'localhost:8080', threads: [{ id: 'localhost' }] },
        { host: 'proxy.example', threads: [{ id: 'proxy' }] },
      ],
      titleWarnings: [{ key: '/removed', reason: 'HTTP 404' }],
    });
    const linkDiff = plan.report.fidelityMismatches.find(
      ({ externalId }) => externalId === 'disqus:reply-5',
    )?.diffs[0];
    expect(linkDiff?.field).toBe('tags');
    expect(linkDiff?.diff).toContain('<p> <a> </a> </p>');
    expect(fetchTitle.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://blog.example/notes/',
      'https://blog.example/removed/',
    ]);
    const imported = () =>
      db.prepare('SELECT * FROM comment ORDER BY external_id').all();
    expect(imported()).toEqual([]);
    const sql = importSql(plan);
    db.exec(sql);
    await expect(verifyImport(query, plan)).resolves.toEqual({
      comments: 8,
      pages: 2,
    });

    const firstRun = imported();
    expect(firstRun).toHaveLength(8);
    const rejected = firstRun.find(
      (row) => row.external_id === 'disqus:spam-parent',
    );
    expect(rejected?.id).toMatch(
      /^016f60fa-1600-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(rejected).toMatchObject({
      status: 'rejected',
      commenter_name: 'Anonymous',
      body_md: 'Hidden original body',
      body_html: '<p>Hidden original body</p>\n',
      commenter_email: null,
      created_at: createdAt,
      status_changed_at: createdAt,
      page_id: pageId,
    });
    expect(
      firstRun.find((row) => row.external_id === 'disqus:removed-post'),
    ).toMatchObject({ status: 'published', commenter_name: 'Anonymous' });
    expect(
      db.prepare('SELECT key, title FROM page ORDER BY key').all(),
    ).toEqual([
      { key: '/notes', title: 'Admin title' },
      { key: '/removed', title: 'The old Page & its notes' },
    ]);

    expect(
      firstRun.find((row) => row.external_id === 'disqus:duplicate-post')
        ?.body_md,
    ).toBe("It's another Comment; hello!");

    const rerun = await planDisqusImport(
      xml,
      await readImportState(query, siteId),
      fetchTitle,
    );
    expect(rerun.report.counts).toMatchObject({
      newPages: 0,
      reusedPages: 2,
      commentsToInsert: 0,
      alreadyImported: 8,
    });
    db.exec(importSql(rerun));
    expect(imported()).toEqual(firstRun);
    await expect(verifyImport(query, rerun)).resolves.toEqual({
      comments: 8,
      pages: 2,
    });
    db.exec(sql);
    expect(imported()).toEqual(firstRun);
    db.prepare(
      "UPDATE comment SET parent_id = NULL WHERE external_id = 'disqus:reply-5'",
    ).run();
    await expect(verifyImport(query, rerun)).rejects.toThrow(
      /disqus:reply-5.*parent/,
    );
  } finally {
    db.close();
  }
});

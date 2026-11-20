/// <reference types="vite/client" />
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import {
  importStatements,
  planDisqusImport,
  readImportState,
  type ImportQuery,
} from '../../src/cli/disqus-import';
import { type PublicComment } from '../../src/shared/public-comments';
import xml from '../fixtures/disqus.xml?raw';

test('returns imported Comments and their removed ancestor through the public API', async () => {
  const siteId = '01941f29-7c00-73e4-a310-744d2167fc5b';
  const origin = 'https://blog.example';
  const createdAt = '2020-01-01T12:00:00.000Z';
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO site (id, name, default_language, created_at, updated_at) VALUES (?, 'Blog', 'en', ?, ?)",
    ).bind(siteId, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO site_origin (id, site_id, origin) VALUES ('019a0000-0000-7000-8000-0000000000a1', ?, ?)",
    ).bind(siteId, origin),
  ]);
  const query: ImportQuery = async <Row>(sql: string) =>
    (await env.DB.prepare(sql).all<Row>()).results;
  const plan = await planDisqusImport(
    xml,
    await readImportState(query, siteId),
    () => Promise.resolve(new Response('<title>Live title</title>')),
  );
  await env.DB.batch(importStatements(plan).map((sql) => env.DB.prepare(sql)));

  const response = await SELF.fetch(
    'https://comments.example/api/comments?page=/notes',
    {
      headers: { Origin: origin },
    },
  );
  expect(response.status).toBe(200);
  const { comments } = await response.json<{ comments: PublicComment[] }>();
  expect(comments).toHaveLength(7);
  const removed = comments.find((comment) => 'removed' in comment);
  expect(removed?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(removed).toEqual({
    id: removed?.id,
    parentId: null,
    createdAt,
    removed: true,
  });
  const deepest = comments.find(
    (comment) => 'name' in comment && comment.name === 'Nico Drift',
  );
  expect(deepest && 'html' in deepest && deepest.html).toContain(
    '>https://example.com/expanded-target</a>',
  );
  let current = deepest;
  for (let depth = 0; depth < 5; depth += 1) {
    current = comments.find((comment) => comment.id === current?.parentId);
    expect(current).toBeDefined();
  }
  expect(current).toEqual(removed);
});

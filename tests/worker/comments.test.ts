import { SELF, createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, expect, test, vi } from 'vitest';
import worker from '../../src/worker';

const origin = 'https://blog.example';
const alternateOrigin = 'http://old-blog.example:8080';
const api = 'https://comments.example/api/comments';
const createdAt = '2026-10-18T09:00:00.000Z';
const siteId = '019a0000-0000-7000-8000-000000000001';
const otherSiteId = '019a0000-0000-7000-8000-000000000002';
const pageId = '019a0000-0000-7000-8000-000000000003';
const parentId = '019a0000-0000-7000-8000-000000000004';
const middleId = '019a0000-0000-7000-8000-000000000005';
const publishedId = '019a0000-0000-7000-8000-000000000006';
const pendingId = '019a0000-0000-7000-8000-000000000007';
const explicitPageId = '019a0000-0000-7000-8000-000000000008';
const explicitCommentId = '019a0000-0000-7000-8000-000000000009';
const rejectedId = '019a0000-0000-7000-8000-000000000010';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO site (id, name, default_language, created_at, updated_at) VALUES (?, 'Blog', 'cs', ?, ?), (?, 'Other', 'en', ?, ?)",
    ).bind(siteId, createdAt, createdAt, otherSiteId, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO site_origin (id, site_id, origin) VALUES ('019a0000-0000-7000-8000-0000000000a1', ?, ?), ('019a0000-0000-7000-8000-0000000000a2', ?, ?), ('019a0000-0000-7000-8000-0000000000a3', ?, ?)",
    ).bind(
      siteId,
      origin,
      siteId,
      alternateOrigin,
      otherSiteId,
      'https://other.example',
    ),
    env.DB.prepare(
      "INSERT INTO page (id, site_id, key, url, title, created_at, updated_at) VALUES (?, ?, '/Page', ?, 'Page', ?, ?), (?, ?, '/Exact//?q=a', ?, 'Exact', ?, ?)",
    ).bind(
      pageId,
      siteId,
      origin + '/Page',
      createdAt,
      createdAt,
      explicitPageId,
      siteId,
      origin + '/Exact',
      createdAt,
      createdAt,
    ),
    ...[
      [parentId, pageId, null, 'rejected', 'Hidden grandparent'],
      [middleId, pageId, parentId, 'pending', 'Hidden parent'],
      [publishedId, pageId, middleId, 'published', 'Ada'],
      [pendingId, pageId, publishedId, 'pending', 'Hidden pending leaf'],
      [rejectedId, pageId, null, 'rejected', 'Hidden rejected leaf'],
      [explicitCommentId, explicitPageId, null, 'published', 'Sam'],
    ].map(([id, currentPage, parent, status, name]) =>
      env.DB.prepare(
        "INSERT INTO comment (id, page_id, parent_id, status, commenter_name, commenter_email, body_md, body_html, html_version, created_at, status_changed_at) VALUES (?, ?, ?, ?, ?, 'private@example.test', 'Hello', '<p>Hello</p>', 1, ?, ?)",
      ).bind(id, currentPage, parent, status, name, createdAt, createdAt),
    ),
  ]);
});

test.each([
  undefined,
  'null',
  'https://unregistered.example',
  'http://blog.example',
])('rejects unregistered Origin %s', async (value) => {
  const response = await SELF.fetch(
    api,
    value ? { headers: { Origin: value } } : {},
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: 'origin_not_allowed' },
  });
  expect(response.headers.get('vary')).toBe('Origin');
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

test('returns the Site config and visible Comments on a normalized Page key', async () => {
  const response = await SELF.fetch(
    api + '?page=%2F%2FPage%2Findex.html%3Fx%3D1',
    {
      headers: { Origin: alternateOrigin },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(
    alternateOrigin,
  );
  expect(response.headers.get('vary')).toBe('Origin');
  expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(response.headers.get('strict-transport-security')).toBe(
    'max-age=31536000',
  );
  const result = await response.json<{ site: unknown; comments: unknown[] }>();
  expect(result.site).toEqual({
    language: 'cs',
    turnstileSiteKey: '1x00000000000000000000AA',
  });
  expect(result.comments).toHaveLength(3);
  expect(result.comments).toEqual(
    expect.arrayContaining([
      { id: parentId, parentId: null, createdAt, removed: true },
      { id: middleId, parentId, createdAt, removed: true },
      {
        id: publishedId,
        parentId: middleId,
        createdAt,
        name: 'Ada',
        html: '<p>Hello</p>',
      },
    ]),
  );
});

test('preserves an explicit Page key that looks like a path', async () => {
  const params = new URLSearchParams({
    page: ' /Exact//?q=a ',
    pageType: 'explicit',
  });
  const response = await SELF.fetch(api + '?' + params.toString(), {
    headers: { Origin: origin },
  });
  expect(await response.json()).toMatchObject({
    comments: [{ id: explicitCommentId }],
  });
});

test.each([
  [origin, '/unknown', 'cs'],
  ['https://other.example', '/Page', 'en'],
])(
  'returns no Comments for an unknown Page of %s',
  async (siteOrigin, key, language) => {
    const response = await SELF.fetch(api + '?page=' + key, {
      headers: { Origin: siteOrigin },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      site: { language, turnstileSiteKey: '1x00000000000000000000AA' },
      comments: [],
    });
  },
);

test('returns the CORS policy for a matched preflight', async () => {
  const response = await SELF.fetch(api, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('vary')).toBe('Origin');
  expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  expect(response.headers.get('access-control-max-age')).toBe('86400');
  expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  expect(response.headers.get('content-security-policy')).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
});

test('denies preflight for an unregistered Origin', async () => {
  const response = await SELF.fetch(api, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unknown.example',
      'Access-Control-Request-Method': 'GET',
    },
  });
  expect(response.status).toBe(403);
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
});

test('returns 429 when the API limiter denies the connecting IP', async () => {
  const limit = vi.fn().mockResolvedValue({ success: false });
  const response = await worker.fetch(
    new Request(api + '?page=/Page', {
      headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.12' },
    }),
    {
      DB: env.DB,
      BACKUPS: env.BACKUPS,
      TURNSTILE_SITE_KEY: 'test',
      TURNSTILE_SECRET: 'test',
      EMAIL: { send: vi.fn() },
      ADMIN_EMAIL: 'admin@example.test',
      EMAIL_FROM: 'notifications@example.test',
      CUSTOM_DOMAIN: 'comments.example.test',
      RL_API: { limit },
      RL_SUBMIT: { limit },
    },
    createExecutionContext(),
  );
  expect(limit).toHaveBeenCalledWith({ key: '203.0.113.12' });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: { code: 'rate_limited' } });
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

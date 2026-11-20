import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DeploymentExport } from '../../src/shared/export';
import worker from '../../src/worker';

const scheduledTime = new Date('2026-01-04T03:00:00.000Z');
const backupKey = 'backups/edge-comments-2026-01-04.json';
const sendEmail =
  vi.fn<
    (message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>
  >();

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ messageId: 'test-message' });
});

afterEach(() => vi.restoreAllMocks());

async function dispatchBackup(backups = env.BACKUPS) {
  const ctx = createExecutionContext();
  const controller = createScheduledController({
    scheduledTime,
    cron: '0 3 * * SUN',
  });
  worker.scheduled(
    controller,
    {
      DB: env.DB,
      BACKUPS: backups,
      TURNSTILE_SITE_KEY: 'test',
      TURNSTILE_SECRET: 'test-secret',
      RL_API: { limit: vi.fn() },
      RL_SUBMIT: { limit: vi.fn() },
      EMAIL: { send: sendEmail },
      ADMIN_EMAIL: 'admin@example.test',
      EMAIL_FROM: 'notifications@example.test',
      CUSTOM_DOMAIN: 'comments.example.test',
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

test('writes the deployment export under the scheduled UTC date without emailing the Admin', async () => {
  const siteId = '019a0000-0000-7000-8000-000000000001';
  const pageId = '019a0000-0000-7000-8000-000000000002';
  const commentId = '019a0000-0000-7000-8000-000000000003';
  const createdAt = '2026-01-03T12:00:00.000Z';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO site (id, name, moderation_mode, default_language, created_at, updated_at)
       VALUES (?, 'Blog', 'approve_first', 'en', ?, ?)`,
    ).bind(siteId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO site_origin (id, site_id, origin) VALUES ('019a0000-0000-7000-8000-0000000000a1', ?, 'https://blog.example.test')`,
    ).bind(siteId),
    env.DB.prepare(
      `INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
       VALUES (?, ?, '/first', 'https://blog.example.test/first', 'First Page', ?, ?)`,
    ).bind(pageId, siteId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO comment (id, page_id, status, commenter_name, commenter_email, body_md,
                           body_html, html_version, created_at, status_changed_at)
       VALUES (?, ?, 'rejected', 'Ada', 'ada@example.test', 'Hello', '<p>Hello</p>',
               1, ?, ?)`,
    ).bind(commentId, pageId, createdAt, createdAt),
  ]);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  const startedAt = Date.now();
  await dispatchBackup();

  const backup = await env.BACKUPS.get(backupKey);
  if (!backup) throw new Error('Expected R2 backup');
  expect(backup.httpMetadata?.contentType).toBe('application/json');
  const { exported_at, ...data } = await backup.json<DeploymentExport>();
  expect(exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(Date.parse(exported_at)).toBeGreaterThanOrEqual(startedAt);
  expect(data).toEqual({
    format: 'edge-comments-export',
    version: 1,
    sites: [
      {
        id: siteId,
        name: 'Blog',
        moderation_mode: 'approve_first',
        default_language: 'en',
        origins: ['https://blog.example.test'],
        pages: [
          {
            id: pageId,
            key: '/first',
            url: 'https://blog.example.test/first',
            title: 'First Page',
            created_at: createdAt,
            comments: [
              {
                id: commentId,
                parent_id: null,
                status: 'rejected',
                commenter_name: 'Ada',
                commenter_email: 'ada@example.test',
                body_md: 'Hello',
                external_id: null,
                created_at: createdAt,
                status_changed_at: createdAt,
              },
            ],
          },
        ],
      },
    ],
  });
  expect(sendEmail).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: 'weekly_backup',
      result: 'success',
      key: backupKey,
    }),
  );
});

test('keeps the newest 50 of 53 backup dates across R2 pages and preserves unrelated objects', async () => {
  const priorBackups = Array.from({ length: 52 }, (_, index) => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const date = new Date(scheduledTime.getTime() - (index + 1) * week);
    return `backups/edge-comments-${date.toISOString().slice(0, 10)}.json`;
  });
  // Upload in reverse date order so that upload time cannot drive retention.
  for (const key of priorBackups) await env.BACKUPS.put(key, '{}');

  // Sort ahead of the backups and force some valid backups onto a second page.
  const unrelated = (index: number) =>
    `backups/edge-comments-0000-${index}.txt`;
  for (let start = 0; start < 960; start += 60) {
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        env.BACKUPS.put(unrelated(start + index), 'text'),
      ),
    );
  }
  const otherExport = 'backups/manual-export.json';
  await env.BACKUPS.put(otherExport, '{}');
  vi.spyOn(console, 'log').mockImplementation(() => {});

  await dispatchBackup();

  const { objects } = await env.BACKUPS.list({
    prefix: 'backups/edge-comments-20',
  });
  expect(objects.map(({ key }) => key).sort()).toEqual(
    [backupKey, ...priorBackups.slice(0, 49)].sort(),
  );
  const { objects: unrelatedObjects } = await env.BACKUPS.list({
    prefix: 'backups/edge-comments-0000-',
  });
  expect(unrelatedObjects).toHaveLength(960);
  expect(await env.BACKUPS.head(otherExport)).not.toBeNull();
});

test('emails the Admin when R2 rejects the backup and keeps the error details out of logs', async () => {
  const message =
    'R2\r\n upload\t rejected\u0085 ada@example.test\u2028 and\u2029 Comment\u202e body';
  const backups = new Proxy(env.BACKUPS, {
    get(target, key): unknown {
      if (key === 'put') return vi.fn().mockRejectedValue(new Error(message));
      return Reflect.get(target, key);
    },
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(dispatchBackup(backups)).rejects.toThrow(
    'Scheduled backup failed',
  );

  expect(sendEmail).toHaveBeenCalledExactlyOnceWith({
    from: { name: 'edge-comments', email: 'notifications@example.test' },
    to: 'admin@example.test',
    subject:
      'Backup failed: R2 upload rejected ada@example.test and Comment body',
    text: `Backup failed: ${message}`,
  });
  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: 'weekly_backup',
      result: 'failure',
      stage: 'write',
    }),
  );
  expect(await env.BACKUPS.head(backupKey)).toBeNull();
});

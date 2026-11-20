import { expect, test } from 'vitest';
import { buildExport, type ExportRows } from './export';

const createdAt = '2026-01-01T00:00:00.000Z';
const exportedAt = new Date('2026-02-01T00:00:00.000Z');

test('exports the exact v1 hierarchy and keeps a removed parent alongside all Comment statuses', () => {
  const storedComment = {
    id: 'removed',
    pageId: 'page',
    parentId: null,
    status: 'rejected',
    commenterName: 'Anonymous',
    commenterEmail: null,
    bodyMd: '',
    externalId: 'disqus:123',
    createdAt,
    statusChangedAt: '2026-01-03T00:00:00.000Z',
  } as const;
  const rows: ExportRows = {
    sites: [
      {
        id: 'site',
        name: 'Blog',
        moderationMode: 'approve_first',
        defaultLanguage: 'cs',
      },
      {
        id: 'empty-site',
        name: 'Notes',
        moderationMode: 'publish_immediately',
        defaultLanguage: 'en',
      },
    ],
    origins: [
      { siteId: 'site', origin: 'https://blog.example.test' },
      { siteId: 'site', origin: 'https://www.blog.example.test' },
    ],
    pages: [
      {
        id: 'page',
        siteId: 'site',
        key: '/article',
        url: 'https://blog.example.test/article',
        title: 'Article',
        createdAt,
      },
      {
        id: 'empty-page',
        siteId: 'site',
        key: '/empty',
        url: 'https://blog.example.test/empty',
        title: 'Empty',
        createdAt,
      },
    ],
    comments: [
      storedComment,
      {
        ...storedComment,
        id: 'reply',
        parentId: 'removed',
        status: 'published',
        commenterName: 'Reader',
        commenterEmail: 'reader@example.test',
        bodyMd: 'A **reply**',
        externalId: null,
      },
      { ...storedComment, id: 'pending', status: 'pending', externalId: null },
    ],
  };

  expect(buildExport(rows, exportedAt)).toStrictEqual({
    format: 'edge-comments-export',
    version: 1,
    exported_at: '2026-02-01T00:00:00.000Z',
    sites: [
      {
        id: 'site',
        name: 'Blog',
        moderation_mode: 'approve_first',
        default_language: 'cs',
        origins: ['https://blog.example.test', 'https://www.blog.example.test'],
        pages: [
          {
            id: 'page',
            key: '/article',
            url: 'https://blog.example.test/article',
            title: 'Article',
            created_at: createdAt,
            comments: [
              {
                id: 'removed',
                parent_id: null,
                status: 'rejected',
                commenter_name: 'Anonymous',
                commenter_email: null,
                body_md: '',
                external_id: 'disqus:123',
                created_at: createdAt,
                status_changed_at: '2026-01-03T00:00:00.000Z',
              },
              {
                id: 'reply',
                parent_id: 'removed',
                status: 'published',
                commenter_name: 'Reader',
                commenter_email: 'reader@example.test',
                body_md: 'A **reply**',
                external_id: null,
                created_at: createdAt,
                status_changed_at: '2026-01-03T00:00:00.000Z',
              },
              {
                id: 'pending',
                parent_id: null,
                status: 'pending',
                commenter_name: 'Anonymous',
                commenter_email: null,
                body_md: '',
                external_id: null,
                created_at: createdAt,
                status_changed_at: '2026-01-03T00:00:00.000Z',
              },
            ],
          },
          {
            id: 'empty-page',
            key: '/empty',
            url: 'https://blog.example.test/empty',
            title: 'Empty',
            created_at: createdAt,
            comments: [],
          },
        ],
      },
      {
        id: 'empty-site',
        name: 'Notes',
        moderation_mode: 'publish_immediately',
        default_language: 'en',
        origins: [],
        pages: [],
      },
    ],
  });
});

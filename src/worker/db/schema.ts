import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { LANGUAGES, MODERATION_MODES } from '../../shared/site-settings';

export const site = sqliteTable('site', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  moderationMode: text('moderation_mode', {
    enum: MODERATION_MODES,
  })
    .notNull()
    .default('approve_first'),
  defaultLanguage: text('default_language', { enum: LANGUAGES }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const siteOrigin = sqliteTable(
  'site_origin',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'restrict' }),
    origin: text('origin').notNull(),
  },
  (table) => [uniqueIndex('site_origin_origin_unique').on(table.origin)],
);

export const page = sqliteTable(
  'page',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('page_site_key_unique').on(table.siteId, table.key)],
);

export const comment = sqliteTable(
  'comment',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'restrict' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => comment.id, {
      onDelete: 'restrict',
    }),
    status: text('status', {
      enum: ['pending', 'published', 'rejected'],
    }).notNull(),
    commenterName: text('commenter_name').notNull(),
    commenterEmail: text('commenter_email'),
    bodyMd: text('body_md').notNull(),
    bodyHtml: text('body_html').notNull(),
    htmlVersion: integer('html_version').notNull(),
    externalId: text('external_id'),
    createdAt: text('created_at').notNull(),
    statusChangedAt: text('status_changed_at').notNull(),
  },
  (table) => [
    uniqueIndex('comment_external_id_unique').on(table.externalId),
    index('comment_page_status_created_idx').on(
      table.pageId,
      table.status,
      table.createdAt,
    ),
    index('comment_status_created_id_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index('comment_parent_idx').on(table.parentId),
  ],
);

import type {
  comment,
  page,
  site,
  siteOrigin,
} from '../../src/worker/db/schema';

const start = Date.UTC(2025, 0, 1);
const siteCount = 3;
const pageCount = 12;

// Counts of live export messages by HTML character length. The source export
// stays local. Only this histogram is used to generate entirely synthetic text.
const bodyLengths = [
  { max: 40, count: 31 },
  { max: 80, count: 50 },
  { max: 160, count: 90 },
  { max: 320, count: 93 },
  { max: 640, count: 95 },
  { max: 1280, count: 35 },
  { max: 2560, count: 6 },
  { max: 5120, count: 1 },
];
const sampleCount = bodyLengths.reduce(
  (total, bucket) => total + bucket.count,
  0,
);

function fixtureId(timestamp: number, sequence: number) {
  const time = timestamp.toString(16).padStart(12, '0');
  const suffix = sequence.toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${suffix}`;
}

function sampleBodyLength(random: number) {
  let sample = random % sampleCount;
  let min = 12;
  for (const { max, count } of bodyLengths) {
    if (sample < count) return min + ((random >>> 12) % (1 + max - min));
    sample -= count;
    min = max + 1;
  }
  throw new Error('Body length sample falls outside the histogram');
}

export function createSyntheticDeployment() {
  const createdAt = new Date(start).toISOString();
  const sites: (typeof site.$inferSelect)[] = Array.from(
    { length: siteCount },
    (_, index) => ({
      id: fixtureId(start, index),
      name: 'Example Site ' + (index + 1),
      moderationMode: 'approve_first',
      defaultLanguage: index === 0 ? 'cs' : 'en',
      createdAt,
      updatedAt: createdAt,
    }),
  );
  const origins: (typeof siteOrigin.$inferSelect)[] = sites.map(
    ({ id }, index) => ({
      id: fixtureId(start - 1, index),
      siteId: id,
      origin: `https://site-${index + 1}.example.test`,
    }),
  );
  const pages: (typeof page.$inferSelect)[] = Array.from(
    { length: pageCount },
    (_, index) => {
      const key = '/article-' + (index + 1);
      const origin = origins[index % siteCount];
      return {
        id: fixtureId(start, siteCount + index),
        siteId: origin.siteId,
        key,
        url: origin.origin + key,
        title: 'Example article ' + (index + 1),
        createdAt,
        updatedAt: createdAt,
      };
    },
  );

  let random = 20261118;
  const sentence = 'This is a synthetic comment about an example article. ';
  const comments: (typeof comment.$inferSelect)[] = [];
  for (let index = 0; index < 5000; index++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const bodyLength = sampleBodyLength(random);
    const bodyMd = sentence
      .repeat(Math.ceil(bodyLength / sentence.length))
      .slice(0, bodyLength)
      .trimEnd();
    // A large run of equal timestamps also exercises the pagination tie-break.
    const timestamp = start + Math.min(Math.floor(index / 3), 900) * 1000;
    const writtenAt = new Date(timestamp).toISOString();
    comments.push({
      id: fixtureId(timestamp, siteCount + pageCount + index),
      pageId: pages[index % pageCount].id,
      parentId:
        Math.floor(index / pageCount) % 5 === 4
          ? comments[index - pageCount].id
          : null,
      status:
        index >= 4982 ? 'pending' : index % 5 === 0 ? 'rejected' : 'published',
      commenterName: 'Commenter ' + (index + 1),
      commenterEmail:
        index % 3 === 0 ? `commenter-${index + 1}@example.test` : null,
      bodyMd,
      bodyHtml: '<p>' + bodyMd + '</p>',
      htmlVersion: 1,
      externalId: index % 4 === 0 ? 'disqus:' + (index + 1) : null,
      createdAt: writtenAt,
      statusChangedAt: writtenAt,
    });
  }
  return { sites, origins, pages, comments };
}

export async function seedSyntheticDeployment(db: D1Database) {
  const { sites, origins, pages, comments } = createSyntheticDeployment();
  await db.batch([
    ...sites.map((row) =>
      db
        .prepare(
          `INSERT INTO site (id, name, moderation_mode, default_language, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.name,
          row.moderationMode,
          row.defaultLanguage,
          row.createdAt,
          row.updatedAt,
        ),
    ),
    ...origins.map((row) =>
      db
        .prepare(
          'INSERT INTO site_origin (id, site_id, origin) VALUES (?, ?, ?)',
        )
        .bind(row.id, row.siteId, row.origin),
    ),
    ...pages.map((row) =>
      db
        .prepare(
          `INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.siteId,
          row.key,
          row.url,
          row.title,
          row.createdAt,
          row.updatedAt,
        ),
    ),
  ]);
  for (let offset = 0; offset < comments.length; offset += 100) {
    await db.batch(
      comments.slice(offset, offset + 100).map((row) =>
        db
          .prepare(
            `INSERT INTO comment (id, page_id, parent_id, status, commenter_name, commenter_email,
                              body_md, body_html, html_version, external_id, created_at, status_changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.id,
            row.pageId,
            row.parentId,
            row.status,
            row.commenterName,
            row.commenterEmail,
            row.bodyMd,
            row.bodyHtml,
            row.htmlVersion,
            row.externalId,
            row.createdAt,
            row.statusChangedAt,
          ),
      ),
    );
  }
}

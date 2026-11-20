import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DomUtils, parseDocument } from 'htmlparser2';
import { ANONYMOUS_NAME } from '../shared/comment-input';
import { COMMENT_RENDERER_VERSION } from '../shared/comment-renderer';
import {
  convertDisqusComment,
  type DisqusFidelityDiff,
} from '../shared/disqus-comment';
import { createId, isoTimestamp } from '../shared/identity';
import { normalizePageKey } from '../shared/page-key';
import { storedPageMetadata } from '../shared/page-metadata';
import type { comment, page, site, siteOrigin } from '../worker/db/schema';

type DsqRef = { '@_dsq:id': string };
type DisqusThread = DsqRef & { link: string; title: string };
type DisqusPost = DsqRef & {
  thread: DsqRef;
  parent?: DsqRef;
  author?: { name?: string };
  createdAt: string;
  message: string;
  isSpam: string;
  isDeleted: string;
};

type ImportedRow = {
  external_id: string;
  site_id: string;
  key: string;
  parent_id: string | null;
  parent_external_id: string | null;
  parent_page_id: string | null;
  page_id: string;
};

export type ImportQuery = <Row>(sql: string) => Promise<Row[]>;

const prefix = 'disqus:';
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (_tag, path) => path === 'disqus.thread' || path === 'disqus.post',
});

function sqlText(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function importedRows(query: ImportQuery) {
  return query<ImportedRow>(
    `SELECT c.external_id, p.site_id, p.key, c.page_id, c.parent_id,
            parent.external_id AS parent_external_id, parent.page_id AS parent_page_id
     FROM comment c
     JOIN page p ON p.id = c.page_id
     LEFT JOIN comment parent ON parent.id = c.parent_id
     WHERE c.external_id GLOB 'disqus:*'`,
  );
}

export type ImportSite = Pick<typeof site.$inferSelect, 'id' | 'name'>;

export function listImportSites(query: ImportQuery) {
  return query<ImportSite>('SELECT id, name FROM site ORDER BY name, id');
}

export async function readImportState(query: ImportQuery, siteId: string) {
  const id = sqlText(siteId);
  const [site] = await query<ImportSite>(
    `SELECT id, name FROM site WHERE id = ${id}`,
  );
  if (!site) throw new Error(`Site ${siteId} does not exist.`);
  const origins = await query<Pick<typeof siteOrigin.$inferSelect, 'origin'>>(
    `SELECT origin FROM site_origin WHERE site_id = ${id}`,
  );
  const pages = await pageKeys(query, siteId);
  const imported = await importedRows(query);
  return {
    siteId,
    origins: new Set(origins.map(({ origin }) => origin)),
    pages: new Set(pages),
    imported: new Map(imported.map((row) => [row.external_id, row])),
  };
}

async function pageKeys(query: ImportQuery, siteId: string) {
  const rows = await query<{ key: string }>(
    `SELECT key FROM page WHERE site_id = ${sqlText(siteId)}`,
  );
  return rows.map(({ key }) => key);
}

type ImportState = Awaited<ReturnType<typeof readImportState>>;

type ImportPage = Pick<typeof page.$inferInsert, 'key' | 'url' | 'title'>;
type ImportComment = {
  key: string;
  externalId: string;
  parentExternalId: string | null;
  status: Exclude<typeof comment.$inferInsert.status, 'pending'>;
  name: string;
  createdAt: string;
  bodyMd: string;
  bodyHtml: string;
};

async function liveTitle(
  url: string,
  fetchTitle: typeof fetch,
): Promise<string> {
  const response = await fetchTitle(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const title = DomUtils.findOne(
    (node) => node.name === 'title',
    parseDocument(await response.text()).children,
  );
  const value =
    title && DomUtils.textContent(title).replace(/\s+/g, ' ').trim();
  if (!value) throw new Error('No HTML title');
  return value;
}

export async function planDisqusImport(
  xml: string,
  state: ImportState,
  fetchTitle: typeof fetch = fetch,
) {
  // Disqus exports do not need custom XML entities or DTDs.
  const hasDoctype = xml
    .match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<!DOCTYPE\b/g)
    ?.includes('<!DOCTYPE');
  if (hasDoctype || XMLValidator.validate(xml) !== true) {
    throw new Error('Expected valid Disqus XML without a DOCTYPE.');
  }
  const { disqus } = xmlParser.parse(xml) as {
    disqus?: { thread?: DisqusThread[]; post?: DisqusPost[] } | string;
  };
  if (disqus === undefined) throw new Error('Missing Disqus XML root.');
  const threads = typeof disqus === 'string' ? [] : (disqus.thread ?? []);
  const posts = typeof disqus === 'string' ? [] : (disqus.post ?? []);
  const threadIds = new Set(threads.map((thread) => thread['@_dsq:id']));
  const postById = new Map(posts.map((post) => [post['@_dsq:id'], post]));
  if (
    threads.some((thread) => !thread['@_dsq:id']) ||
    threadIds.size !== threads.length
  ) {
    throw new Error('Missing or duplicate Disqus thread ID.');
  }
  if (
    posts.some((post) => !post['@_dsq:id']) ||
    postById.size !== posts.length
  ) {
    throw new Error('Missing or duplicate Disqus post ID.');
  }

  const live = (post: DisqusPost) =>
    post.isDeleted !== 'true' && post.isSpam !== 'true';
  const liveThreads = new Set(
    posts.filter(live).map((post) => post.thread?.['@_dsq:id']),
  );
  for (const id of liveThreads) {
    if (!threadIds.has(id))
      throw new Error('A live Disqus post has no thread.');
  }
  const pages = new Map<string, ImportPage>();
  const keyByThread = new Map<string, string>();
  const skippedHosts = new Map<string, { id: string; link: string }[]>();
  for (const thread of threads) {
    const id = thread['@_dsq:id'];
    if (!liveThreads.has(id)) continue;
    const link = thread.link?.trim() ?? '';
    const url = URL.parse(link);
    if (!url || !state.origins.has(url.origin)) {
      const host = url?.host || '(invalid URL)';
      const skippedThreads = skippedHosts.get(host) ?? [];
      skippedThreads.push({ id, link });
      skippedHosts.set(host, skippedThreads);
      continue;
    }
    const key = normalizePageKey(link, 'path');
    if (key === null)
      throw new Error(`Invalid Page key for Disqus thread ${id}.`);
    keyByThread.set(id, key);
    if (!pages.has(key)) {
      url.search = '';
      url.hash = '';
      pages.set(key, { key, url: url.href, title: thread.title ?? '' });
    }
  }

  const keyFor = (post: DisqusPost) =>
    keyByThread.get(post.thread?.['@_dsq:id']);
  const comments: ImportComment[] = [];
  const fidelityMismatches: {
    externalId: string;
    diffs: DisqusFidelityDiff[];
  }[] = [];
  const included = new Set<string>();
  for (const post of posts) {
    const key = keyFor(post);
    if (!live(post) || key === undefined) continue;
    const ancestors: DisqusPost[] = [];
    const visited = new Set<string>();
    let current: DisqusPost | undefined = post;
    while (current && !included.has(current['@_dsq:id'])) {
      const id = current['@_dsq:id'];
      if (visited.has(id))
        throw new Error(`Disqus parent cycle at post ${id}.`);
      visited.add(id);
      ancestors.push(current);
      const parentId: string | undefined = current.parent?.['@_dsq:id'];
      current = parentId ? postById.get(parentId) : undefined;
      if (parentId && (!current || keyFor(current) !== key)) {
        throw new Error(`Missing or off-Page parent for Disqus post ${id}.`);
      }
    }

    for (const entry of ancestors.reverse()) {
      const id = entry['@_dsq:id'];
      const externalId = prefix + id;
      const parentId = entry.parent?.['@_dsq:id'];
      const { bodyMd, bodyHtml, fidelityDiffs } = convertDisqusComment(
        entry.message ?? '',
      );
      if (fidelityDiffs.length)
        fidelityMismatches.push({ externalId, diffs: fidelityDiffs });
      const published = live(entry);
      const name = entry.author?.name ?? '';
      comments.push({
        key,
        externalId,
        parentExternalId: parentId ? prefix + parentId : null,
        status: published ? 'published' : 'rejected',
        name: name.trim() ? name : ANONYMOUS_NAME,
        createdAt: isoTimestamp(Date.parse(entry.createdAt)),
        bodyMd,
        bodyHtml,
      });
      included.add(id);
    }
  }

  const destinationPages = new Map<string, ImportPage>();
  for (const comment of comments) {
    const page = pages.get(comment.key);
    if (!page) throw new Error(`Missing Disqus Page ${comment.key}.`);
    destinationPages.set(comment.key, page);
  }
  const pageList = [...destinationPages.values()];
  const titleWarnings = [];
  for (let start = 0; start < pageList.length; start += 8) {
    const warnings = await Promise.all(
      pageList.slice(start, start + 8).map(async (page) => {
        try {
          page.title = await liveTitle(page.url, fetchTitle);
        } catch (error) {
          return {
            key: page.key,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    titleWarnings.push(...warnings.filter((warning) => warning !== undefined));
  }

  const published = comments.filter(
    (comment) => comment.status === 'published',
  ).length;
  const newPages = pageList.filter((page) => !state.pages.has(page.key)).length;
  const alreadyImported = comments.filter((comment) =>
    state.imported.has(comment.externalId),
  ).length;
  return {
    state,
    pages: pageList,
    comments,
    report: {
      counts: {
        threads: threads.length,
        newPages,
        reusedPages: pageList.length - newPages,
        commentsToInsert: comments.length - alreadyImported,
        alreadyImported,
        skippedSpamOrDeleted: posts.filter(
          (post) => !live(post) && !included.has(post['@_dsq:id']),
        ).length,
        published,
        rejected: comments.length - published,
      },
      skippedHosts: [...skippedHosts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([host, threads]) => ({ host, threads })),
      titleWarnings,
      fidelityMismatches,
    },
  };
}

type ImportPlan = Awaited<ReturnType<typeof planDisqusImport>>;

export function importStatements(plan: ImportPlan): string[] {
  const siteId = sqlText(plan.state.siteId);
  const now = sqlText(isoTimestamp());
  const commentsByPage = Map.groupBy(plan.comments, (comment) => comment.key);
  return [
    ...plan.pages.map(({ key, ...metadata }) => {
      const { url, title } = storedPageMetadata(metadata.url, metadata.title);
      const externalIds =
        commentsByPage.get(key)?.map((comment) => comment.externalId) ?? [];
      return `INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
       SELECT ${sqlText(createId())}, ${siteId}, ${sqlText(key)}, ${sqlText(url)}, ${sqlText(title)}, ${now}, ${now}
       WHERE EXISTS (
         SELECT 1 FROM json_each(${sqlText(JSON.stringify(externalIds))}) AS expected
         WHERE NOT EXISTS (SELECT 1 FROM comment WHERE external_id = expected.value)
       )
       ON CONFLICT(site_id, key) DO NOTHING;`;
    }),
    ...plan.comments.map((comment) => {
      const pageId = `(SELECT id FROM page WHERE site_id = ${siteId} AND key = ${sqlText(comment.key)})`;
      // Guard new replies against a missing parent or a parent on a different Page.
      const externalId = sqlText(comment.externalId);
      const parentId = comment.parentExternalId
        ? `COALESCE((SELECT id FROM comment WHERE external_id = ${sqlText(comment.parentExternalId)} AND page_id = ${pageId}), '')`
        : 'NULL';
      const date = sqlText(comment.createdAt);
      return `INSERT INTO comment (id, page_id, parent_id, status, commenter_name, commenter_email,
         body_md, body_html, html_version, external_id, created_at, status_changed_at)
       SELECT ${sqlText(createId(Date.parse(comment.createdAt)))}, ${pageId}, ${parentId},
         ${sqlText(comment.status)}, ${sqlText(comment.name)}, NULL, ${sqlText(comment.bodyMd)},
         ${sqlText(comment.bodyHtml)}, ${COMMENT_RENDERER_VERSION}, ${externalId}, ${date}, ${date}
       WHERE NOT EXISTS (SELECT 1 FROM comment WHERE external_id = ${externalId})
       ON CONFLICT(external_id) DO NOTHING;`;
    }),
  ];
}

export function importSql(plan: ImportPlan): string {
  const statements = importStatements(plan);
  return statements.length ? statements.join('\n\n') + '\n' : 'SELECT 1;\n';
}

export async function verifyImport(query: ImportQuery, plan: ImportPlan) {
  const siteId = plan.state.siteId;
  const rows = (await importedRows(query)).filter(
    (row) => row.site_id === siteId,
  );
  const actualById = new Map(rows.map((row) => [row.external_id, row]));
  const actualPages = new Set(await pageKeys(query, siteId));
  for (const { key } of plan.pages) {
    if (!actualPages.has(key)) throw new Error(`Missing imported Page ${key}.`);
  }

  const expectedKeys = new Map(
    [...plan.state.imported.values()]
      .filter((row) => row.site_id === siteId)
      .map((row) => [row.external_id, row.key]),
  );
  for (const comment of plan.comments) {
    const row = actualById.get(comment.externalId);
    if (!row)
      throw new Error(`Missing imported Comment ${comment.externalId}.`);
    if (
      (row.parent_id === null) !== (comment.parentExternalId === null) ||
      row.parent_external_id !== comment.parentExternalId
    ) {
      throw new Error(
        `Imported Comment ${comment.externalId} has an unexpected parent.`,
      );
    }
    const { key } = comment;
    if (row.key !== key) {
      throw new Error(
        `Imported Comment ${comment.externalId} belongs to an unexpected Page.`,
      );
    }
    expectedKeys.set(comment.externalId, key);
  }

  if (rows.length !== expectedKeys.size) {
    throw new Error(
      `Expected ${expectedKeys.size} Comments with prefix ${prefix} but found ${rows.length}.`,
    );
  }
  const expectedByPage = Map.groupBy(expectedKeys.values(), (key) => key);
  const actualByPage = Map.groupBy(rows, ({ key }) => key);
  for (const [key, values] of expectedByPage) {
    const expected = values.length;
    const actual = actualByPage.get(key)?.length ?? 0;
    if (actual !== expected)
      throw new Error(
        `Expected ${expected} imported Comments on ${key} but found ${actual}.`,
      );
  }
  for (const row of rows) {
    if (row.parent_id !== null && row.parent_page_id !== row.page_id) {
      throw new Error(
        `Imported Comment ${row.external_id} has a missing or off-Page parent.`,
      );
    }
  }
  return { comments: plan.comments.length, pages: plan.pages.length };
}

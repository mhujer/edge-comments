import type { Context, Hono } from 'hono';
import { createId } from '../../shared/identity';
import { parseSiteSettings } from '../../shared/site-input';
import type { WorkerEnv } from '../bindings';
import { stringField } from '../untrusted-input';
import { countPending } from './data';
import {
  getPage,
  getSite,
  listPageComments,
  listSitePages,
  listSites,
  saveSite,
  type SiteSettings,
} from './site-data';
import {
  addSitePath,
  EmbedSnippet,
  PageComments,
  SiteList,
  SitePages,
  sitePath,
  SiteSettingsForm,
  sitesPath,
  type SiteFormFields,
} from './site-views';
import { AdminLayout, PageLink } from './views';

const defaults: SiteFormFields = {
  name: '',
  origins: '',
  moderationMode: 'approve_first',
  defaultLanguage: 'cs',
};

function siteFields(site: SiteSettings): SiteFormFields {
  return { ...site, origins: site.origins.join('\n') };
}

async function siteScreen(
  context: Context<WorkerEnv>,
  site: Awaited<ReturnType<typeof getSite>>,
  fields: SiteFormFields,
  status: 200 | 400 | 409 = 200,
  error?: string,
) {
  const db = context.env.DB;
  const [pendingCount, pages] = await Promise.all([
    countPending(db),
    site ? listSitePages(db, site.id) : [],
  ]);
  return context.html(
    <AdminLayout
      active="Sites"
      title={site?.name ?? 'Add Site'}
      pendingCount={pendingCount}
    >
      <p>
        <a href={sitesPath}>← Sites</a>
      </p>
      {status === 200 && context.req.query('saved') === '1' && (
        <p class="flash" role="status">
          Site saved.
          {context.req.query('addedOrigin') === '1' && (
            <>
              {' '}
              Please re-run <code>./deploy.sh</code> to update Turnstile.
            </>
          )}
        </p>
      )}
      <SiteSettingsForm
        action={site ? sitePath(site.id) : addSitePath}
        fields={fields}
        creating={!site}
        error={error}
      />
      {site && (
        <>
          <EmbedSnippet
            workerHostname={context.env.CUSTOM_DOMAIN}
            defaultLanguage={site.defaultLanguage}
          />
          <SitePages pages={pages} />
        </>
      )}
    </AdminLayout>,
    status,
  );
}

async function submitSite(context: Context<WorkerEnv>, id?: string) {
  const db = context.env.DB;
  const site = id ? await getSite(db, id) : null;
  if (id && !site) return context.notFound();
  const body = await context.req.parseBody();
  const fields: SiteFormFields = {
    name: stringField(body.name),
    origins: stringField(body.origins),
    moderationMode: stringField(body.moderationMode),
    defaultLanguage: stringField(body.defaultLanguage),
  };
  const settings = parseSiteSettings(fields);
  if (typeof settings === 'string') {
    return siteScreen(context, site, fields, 400, settings);
  }
  const siteId = site?.id ?? createId();
  const result = await saveSite(db, siteId, settings, !site);
  if (result.error) {
    return siteScreen(context, site, fields, 409, result.error);
  }
  const query = new URLSearchParams({ saved: '1' });
  if (result.addedOrigin) query.set('addedOrigin', '1');
  return context.redirect(sitePath(siteId) + '?' + query.toString(), 303);
}

async function pageScreen(
  context: Context<WorkerEnv>,
  page: NonNullable<Awaited<ReturnType<typeof getPage>>>,
) {
  const db = context.env.DB;
  const [comments, pendingCount] = await Promise.all([
    listPageComments(db, page.pageId),
    countPending(db),
  ]);
  return context.html(
    <AdminLayout
      active="Sites"
      title={page.pageTitle || page.pageKey || 'Page'}
      pendingCount={pendingCount}
    >
      <p>
        <a href={sitePath(page.siteId)}>← {page.siteName}</a>
      </p>
      <section class="panel metadata">
        <dl>
          <dt>Live Page</dt>
          <dd>
            <PageLink {...page} />
          </dd>
          <dt>Page key</dt>
          <dd>
            <code>{page.pageKey}</code>
          </dd>
        </dl>
      </section>
      <PageComments comments={comments} />
    </AdminLayout>,
  );
}

export function registerSiteRoutes(admin: Hono<WorkerEnv>) {
  admin.get('/sites', async (context) => {
    const db = context.env.DB;
    const [sites, pendingCount] = await Promise.all([
      listSites(db),
      countPending(db),
    ]);
    return context.html(
      <AdminLayout active="Sites" title="Sites" pendingCount={pendingCount}>
        <SiteList sites={sites} />
      </AdminLayout>,
    );
  });
  admin.get('/sites/new', (context) => siteScreen(context, null, defaults));
  admin.get('/sites/:id', async (context) => {
    const site = await getSite(context.env.DB, context.req.param('id'));
    return site
      ? siteScreen(context, site, siteFields(site))
      : context.notFound();
  });
  admin.post('/sites/new', (context) => submitSite(context));
  admin.post('/sites/:id', (context) =>
    submitSite(context, context.req.param('id')),
  );

  admin.get('/page/:id', async (context) => {
    const page = await getPage(context.env.DB, context.req.param('id'));
    return page ? pageScreen(context, page) : context.notFound();
  });
}

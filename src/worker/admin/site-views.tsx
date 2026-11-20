import type { SiteFields } from '../../shared/site-input';
import type { PageComment, SitePage, SiteSummary } from './site-data';
import { commentPath, pagePath, StatusBadge } from './views';

export const sitesPath = '/admin/sites';
export const addSitePath = sitesPath + '/new';

export function sitePath(id: string) {
  return sitesPath + '/' + encodeURIComponent(id);
}

const moderationModes = {
  approve_first: 'Approve first',
  publish_immediately: 'Publish immediately',
} as const;

export function SiteList({ sites }: { sites: SiteSummary[] }) {
  return (
    <>
      <p>
        <a href={addSitePath}>+ Add Site</a>
      </p>
      {sites.length === 0 ? (
        <p class="empty">No Sites.</p>
      ) : (
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Allowed origins</th>
                <th scope="col">Moderation</th>
                <th scope="col">Language</th>
                <th scope="col">Pages</th>
                <th scope="col">Pending</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr>
                  <th scope="row">
                    <a href={sitePath(site.id)}>{site.name}</a>
                  </th>
                  <td class="origin-list">{site.origins.join('\n') || '—'}</td>
                  <td>{moderationModes[site.moderationMode]}</td>
                  <td>{site.defaultLanguage}</td>
                  <td>{site.pageCount}</td>
                  <td>{site.pendingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export type SiteFormFields = SiteFields;

export function SiteSettingsForm({
  action,
  fields,
  creating,
  error,
}: {
  action: string;
  fields: SiteFormFields;
  creating: boolean;
  error?: string;
}) {
  return (
    <section class="panel">
      <h2>Settings</h2>
      {error && (
        <p class="flash badge-rejected" role="alert">
          {error}
        </p>
      )}
      <form class="settings-form" action={action} method="post">
        <label class="form-field">
          Name
          <input type="text" name="name" value={fields.name} required />
        </label>
        <label class="form-field">
          Allowed origins
          <span class="byline">
            One per line, in the form scheme://host[:port].
          </span>
          <textarea name="origins" rows={4}>
            {fields.origins}
          </textarea>
        </label>
        <fieldset>
          <legend>Moderation</legend>
          {Object.entries(moderationModes).map(([mode, label]) => (
            <label>
              <input
                type="radio"
                name="moderationMode"
                value={mode}
                checked={fields.moderationMode === mode}
                required
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label class="form-field">
          Default language
          <select name="defaultLanguage">
            <option value="cs" selected={fields.defaultLanguage === 'cs'}>
              Čeština
            </option>
            <option value="en" selected={fields.defaultLanguage === 'en'}>
              English
            </option>
          </select>
        </label>
        <button type="submit" class="approve">
          {creating ? 'Create Site' : 'Save settings'}
        </button>
      </form>
    </section>
  );
}

export function EmbedSnippet({
  workerHostname,
  defaultLanguage,
}: {
  workerHostname: string;
  defaultLanguage: string;
}) {
  return (
    <section class="panel">
      <h2>Embed snippet</h2>
      <p>
        Put the snippet where Comments should appear, once per page. The page’s{' '}
        <code>&lt;title&gt;</code> becomes the Page title in the Admin and in
        notification emails.
      </p>
      <pre class="source">
        <code>{`<div id="edge-comments"></div>
<script src="https://${workerHostname}/widget.js" async></script>`}</code>
      </pre>
      <p>Optional attributes on the div:</p>
      <ul>
        <li>
          <code>data-lang="en"</code> or <code>data-lang="cs"</code> overrides
          the Site’s default language ({defaultLanguage}) on that page.
        </li>
        <li>
          <code>data-page-key="/path"</code> sets a stable Page key instead of
          the URL path, for example to keep a post’s Comments after it moves.
        </li>
      </ul>
      <p>
        See <code>docs/self-hosting.md</code> for details and the Content
        Security Policy a host page needs.
      </p>
    </section>
  );
}

export function SitePages({ pages }: { pages: SitePage[] }) {
  return (
    <section class="panel">
      <h2>Pages</h2>
      {pages.length === 0 ? (
        <p>No Pages.</p>
      ) : (
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Published</th>
                <th scope="col">Pending</th>
                <th scope="col">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr>
                  <th scope="row">
                    <a href={pagePath(page.pageId)}>
                      {page.pageTitle || page.pageKey || '(Untitled)'}
                    </a>
                  </th>
                  <td>{page.publishedCount}</td>
                  <td>{page.pendingCount}</td>
                  <td>{page.rejectedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PageComments({ comments }: { comments: PageComment[] }) {
  return (
    <section class="panel replies">
      <h2>Comments</h2>
      {comments.length === 0 ? (
        <p>No Comments.</p>
      ) : (
        <ul>
          {comments.map((comment) => (
            <li>
              <a href={commentPath(comment.id)}>{comment.name}</a>{' '}
              <StatusBadge status={comment.status} />
              <div class="excerpt">{comment.excerpt}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

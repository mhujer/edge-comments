# Self-hosting edge-comments

One Worker serves the widget, API, and Admin. It uses D1 for comments, R2 for weekly JSON backups, Turnstile for submissions, and Cloudflare Access for the Admin. The deployment can use the Workers Free and Zero Trust Free plans.

## Deploy with `./deploy.sh`

Clone the repository and run the deploy script from its root. It does each step itself or asks for what it needs, until the Worker is live with a first Site. Run the same script for every later deploy.

```bash
git clone <repository-url> edge-comments
cd edge-comments
./deploy.sh
```

> **The script changes your Cloudflare account.** It creates a D1 database, an R2 bucket, a Turnstile widget and an Access app, enables Email Routing on the Worker hostname and deploys a Worker. Before you run it the first time, ask your coding agent to read `deploy.sh` and `scripts/lib/cloudflare.sh` and explain what it'll do.

You need Node 24, Git, Bash, `curl` and `jq`, and a Cloudflare account with a domain you can move to Cloudflare DNS. Zero Trust and R2 need a payment card on file, even on their free plans.

Every run goes through the same stages. It checks each one, asks only for what's missing or invalid, and skips the rest, so a fully configured checkout deploys without asking anything. Without a terminal, for example from another script, it fails with a clear message as soon as it needs input. The one exception is an unverified Admin email, which only delays notifications.

1. **Preflight**, before any prompt or remote change: required tools, a clean Git working tree, `npm ci`, Playwright Chromium, `npm run check` and `npm run test:e2e`. The script shows one line per step and writes their output to the git-ignored `tmp/deploy-ci.log`. If a step fails, it shows the end of the log and stops.
2. **API token and account**: the script opens the API tokens page and lists the permissions below. Paste the token at the hidden prompt. If the token sees more than one account, pick one. Both are saved to the git-ignored `.env`.
3. **Dashboard prerequisites**: an active zone, R2 activated, Zero Trust activated and the One-time PIN login method. For each one that's missing, the script opens the right dashboard page, shows how to reach it from the dashboard home, says what to click, and checks again when you press Enter.
4. **Config values**: the Worker hostname (suggested as `comments.<zone>`: a subdomain, not the zone itself, in a zone the token's Zone policy covers), the Zero Trust team hostname (read from Access), and the Admin email for sign-in and notifications. Review them, then the script writes them to the git-ignored `wrangler.jsonc`, created from `wrangler.example.jsonc`. Notifications are always sent from `edge-comments@<Worker hostname>`.
5. **D1 and R2**: creates or reuses the database and bucket and updates the bindings.
6. **Email Routing**: enables it on the Worker hostname and creates the Admin email as a destination. Cloudflare adds MX and SPF records to the Worker hostname only, so mail for your zone keeps its own MX records and provider. Click the verification link Cloudflare emails you, then press Enter. Type `s` to skip; the summary then lists the verification as still to do. Without a terminal, the script deploys anyway and lists it the same way. Until the address is verified, notification emails fail. [Email Routing subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)
7. **Migrations**: `wrangler d1 migrations apply DB --remote`. Migrations take effect before the new Worker goes live, so they must stay additive.
8. **First Site**: only while the database has no Sites. Enter the Site name (a label only you see, in the Admin and notification emails), default language (`cs` or `en`), moderation mode and Allowed origins. Use full origins, such as `https://www.example.com`, with an explicit port if needed and no path.
9. **Turnstile**: one widget listing the hostnames of all Allowed origins, at most ten. [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
10. **Access**: an app on `/admin` with a 24-hour session and a policy that admits only the Admin email via One-time PIN.
11. **Secrets**: the Access audience and Turnstile keys, staged in `.wrangler/secrets.production.json` with mode `0600`.
12. **Deploy**: refuses the local-only `ADMIN_AUTH_BYPASS` setting, builds the widget and deploys the Worker with the staged secrets. A failed deploy stops the run; fix the cause and run `./deploy.sh` again. After a successful deploy it deletes the staged secrets file.
13. **Summary**: the Admin URL, each Site with its default language and Allowed origins, the embed snippet with its optional attributes, the Content Security Policy entries, and anything still to do.
14. **Disqus import**: while the production database has no Comments, each run in a terminal offers to import a Disqus export. With more than one Site, it asks which Site to import into. If you decline, it prints the importer command to run later. See [Import Disqus comments](#import-disqus-comments).

Run `./deploy.sh --reconfigure` to answer the token, account and config questions again, for example to rotate the token. Each prompt shows the current value; press Enter to keep it.

### API token permissions

The script asks for a custom Cloudflare API token. In the dashboard, click **Create Token**, then **Start from scratch**. Add the Account permissions in an Account policy for your account, and the Zone permissions in a Zone policy for the zone hosting the Worker. [Create an API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

| Scope   | Permission                                            | Access |
| ------- | ----------------------------------------------------- | ------ |
| Account | Workers Scripts                                       | Edit   |
| Account | D1                                                    | Edit   |
| Account | Workers R2 Storage                                    | Edit   |
| Account | Turnstile                                             | Edit   |
| Account | Email Routing Addresses                               | Edit   |
| Account | Access: Apps and Policies                             | Edit   |
| Account | Access: Organizations, Identity Providers, and Groups | Read   |
| Zone    | DNS                                                   | Edit   |
| Zone    | Workers Routes                                        | Edit   |
| Zone    | Zone Settings                                         | Edit   |
| Zone    | Zone                                                  | Read   |

The token summary also lists Read for most Edit permissions. That's expected. The API reference also calls the Edit permissions Write. Zone Settings Edit lets the script enable Email Routing. The Access read permission lets it read your team hostname and find the One-time PIN provider. [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

## Register a Site and embed the widget

`./deploy.sh` creates the first Site. To add more:

1. Open `/admin` on the Worker hostname. Sign in with the code sent to `ADMIN_EMAIL`.
2. Open **Sites → Add Site**. Give the Site a name, choose a moderation mode and default language, and add one Allowed origin per line. Use the full origin, such as `https://www.example.com`, with an explicit port if needed. Leave off paths and trailing slashes.
3. After creating a Site or changing any Site’s Allowed origins, run `./deploy.sh` again. It updates the Turnstile widget from the hostnames of all Allowed origins. Keep the deployment to at most ten distinct hostnames.
4. Copy the Site’s embed snippet into each page where you want comments. Use one widget per page and replace `comments.example.com` with your Worker hostname.

```html
<div id="edge-comments"></div>
<script src="https://comments.example.com/widget.js" async></script>
```

By default the widget identifies a Page by its URL path and uses the Site’s default language. Set `data-page-key` on the `div` to use a stable custom key, for example when pages share a path and differ by query string. Set `data-lang="en"` or `data-lang="cs"` on the `div` to override the language on that page. The page’s `<title>` becomes the Page title in the Admin and in notification emails. Each Site page in the Admin shows the snippet with these options.

### Move a post to a new URL

Page keys can’t be edited in the Admin. To keep a post’s Comments after its URL changes, open the Page in the Admin, copy its Page key, and set it as `data-page-key` in the embed on the new URL:

```html
<div id="edge-comments" data-page-key="/old-path"></div>
```

The Page’s link and title in the Admin update with the next new Comment.

### Embedding on a CSP-protected site

Add these origins to the existing Content Security Policy directives of the host page. Replace `https://comments.example.com` with your Worker origin.

| Directive     | Origins                                                            |
| ------------- | ------------------------------------------------------------------ |
| `script-src`  | `https://comments.example.com` `https://challenges.cloudflare.com` |
| `connect-src` | `https://comments.example.com`                                     |
| `frame-src`   | `https://challenges.cloudflare.com`                                |

The widget bundles its CSS in JavaScript and applies it through `document.adoptedStyleSheets`. You can keep your existing `style-src` policy. [Turnstile CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)

### Theme the widget

Set any of these properties in the host page’s stylesheet.

| Property                    | Default                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `--edge-comments-accent`    | `#0b62c4`                                                  |
| `--edge-comments-font`      | `system-ui, sans-serif`                                    |
| `--edge-comments-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

To use your Site’s accent, set `--edge-comments-accent` from your `--accent` property. The widget inherits the page’s text color and bases its tints on that color. If your Site marks its dark theme with `data-theme="dark"`, you can override the widget accent there.

```css
#edge-comments {
  --edge-comments-accent: var(--accent);
}

[data-theme='dark'] #edge-comments {
  --edge-comments-accent: #8fc5ff;
}
```

The custom properties are the stable theming API. Widget class names may change between releases.

## Back up and restore

The Worker writes a weekly JSON export to your R2 bucket on Sunday at 03:00 UTC and retains the newest 50 files. **Admin → Tools** also offers an on-demand JSON download. Use Time Travel or a SQL dump below to restore D1. [JSON export format](export-format.md)

Run this from a configured checkout to save a full SQL dump of the remote database. The script writes a UTC-timestamped `.sql` file under git-ignored `backups/`. Store a copy securely outside the checkout for recovery.

```bash
scripts/backup.sh
```

### Restore with Time Travel

On Workers Free, use Time Travel for a point within the last seven days. Replace the example timestamp with the UTC time you want to restore to. This replaces the state of the live D1 database bound as `DB`. Save a current dump before you proceed and record the undo bookmark Wrangler returns. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

```bash
npx wrangler d1 time-travel restore DB --config wrangler.jsonc --timestamp '2026-11-18T10:00:00Z'
```

If the restore changes any Site’s Allowed origins, run `./deploy.sh` to sync Turnstile with the restored origins.

### Restore a SQL dump into a fresh database

For an older restore point, choose a saved SQL dump. Create an empty database with its own name, then import the dump into that database. Replace the example path with the file you want to restore. The dump includes the schema, so import before applying any migrations. [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

```bash
npx wrangler d1 create edge-comments-restored --config wrangler.jsonc
npx wrangler d1 execute edge-comments-restored --remote --file backups/edge-comments-2026-11-18T100000Z.sql --config wrangler.jsonc
```

After the import succeeds, set the `DB` entry’s `database_name` and `database_id` in `wrangler.jsonc` to the restored database name and the UUID Wrangler printed at creation. Run `./deploy.sh` to sync Turnstile with the restored Site origins, apply any pending migrations and point the Worker at the restored database.

## Import Disqus comments

Get the Disqus XML export and register a Site with the origins of the Pages you want to import. While the production database has no Comments, `./deploy.sh` offers the import: choose the Site, give it the export path, review the remote dry run, then confirm to apply. Once Comments exist, or to import into another Site, use the importer directly. The importer uses URL paths as Page keys and reports Disqus threads on hosts that aren't an Allowed origin of the Site. It skips previously imported Comments on subsequent runs.

Start with a dry run against a local Site with the same origins. Replace `SITE_ID` with the Site UUID from its Admin URL. The importer writes SQL to git-ignored `tmp/` and reports skipped hosts, title warnings, and differences in rendered content. Review its output before applying the import.

```bash
npm run import:disqus -- export.xml --site SITE_ID
```

Add `--apply` to apply and verify against local D1. For the hosted database, use the production Site’s UUID and `--target remote` from the configured checkout. Without `--apply`, it's a dry run that reads production but writes nothing.

```bash
npm run import:disqus -- export.xml --site SITE_ID --apply
npm run import:disqus -- export.xml --site SITE_ID --target remote
npm run import:disqus -- export.xml --site SITE_ID --target remote --apply
```

In an interactive terminal, you can omit `--site` and select a Site at the prompt. Keep the export, generated SQL, and reports private. [Importer reference](../src/cli/README.md)

## Local development

Use Node 24 from the repository root. Copy the local settings and start the dev server.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

The dev server migrates local D1, seeds a Development Site, and watches the widget build. Open <http://localhost:8788> for the seeded preview and <http://localhost:8787/admin> for the local Admin. The example settings enable the Admin bypass for local use and provide Turnstile test keys. A Cloudflare account is optional for local development. [Local tooling](tooling.md)

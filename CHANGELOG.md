# Changelog

Releases that require action from the Admin include a **Manual steps** section with instructions before deployment.

## v1

- Added a self-hosted comments widget with threaded replies, Markdown preview, Turnstile, and English and Czech translations.
- Added the Access-protected Admin for moderation, Site management, Page browsing, email notifications, and JSON export.
- Added weekly R2 backups, a manual SQL backup, and a Disqus importer.

### Manual steps

Clone the repository and run `./deploy.sh`, following the [self-hosting guide](docs/self-hosting.md). It asks for an API token, waits while you finish the dashboard prerequisites and verify the Email Routing address, creates the first Site and deploys. Run `./deploy.sh` again after adding a Site or changing any Allowed origins in the Admin.

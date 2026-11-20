# Disqus importer

Run a dry run against local D1 with the ID of the Site that owns the Pages.

```sh
npm run import:disqus -- export.xml --site <site-id>
```

With an interactive terminal, omitting `--site` opens a Site prompt. The report
lists the planned changes and fidelity diffs and gives the path to the SQL file
in `tmp/`. Keep the export, report and generated SQL private.

Add `--apply` to apply and verify. Add `--target remote` to plan against the
remote D1 configured in Wrangler instead; that run stays a dry run until you
also pass `--apply`.
Re-running preserves previously imported Comments and existing Pages.

Use `WRANGLER_CONFIG` to select another Wrangler configuration and
`WRANGLER_PERSIST_TO` to select a separate directory for local D1 state.

# First Site

`./deploy.sh` runs `npm run create-site` while the remote database has no
Sites. It asks for the name, default language, moderation mode and Allowed
origins, validates them like the Admin's Site form, writes the SQL to `tmp/`
and applies it to remote D1. It needs an interactive terminal and creates
nothing once a Site exists; add later Sites in the Admin.

# Email Routing on the Worker hostname, not the zone apex

Notifications are sent from `edge-comments@<Worker hostname>`, and `./deploy.sh` enables Email Routing on the Worker hostname rather than on the zone apex. Email Routing on the apex needs exclusive control of the apex MX records: Cloudflare refuses it while another provider's MX records exist (error 2008), and enabling it would take the Admin's existing mailbox away from that provider. On a subdomain, Cloudflare adds MX and SPF records to that subdomain only, so the zone's own mail keeps working.

## Considered Options

- **Apex, as before**: fails on any zone that already receives mail elsewhere, which is the common case for a personal or company domain.
- **Subdomain only when the apex has foreign MX records**: two code paths and a detection step for no gain, since sending from the Worker hostname works everywhere.
- **A separate mail subdomain** (such as `mail.<zone>`): one more config value to ask for and validate. The Worker hostname is already a subdomain of a zone the token can use.

## Consequences

The Worker hostname can't be the zone apex itself.

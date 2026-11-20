# Fixtures

Use invented names and synthetic data here. Real exports stay in git-ignored `tmp/`.

`access-test-keys.json` is a throwaway RSA key pair for signing and verifying
Cloudflare Access assertions against a stubbed JWKS endpoint. Use it only in tests.

`synthetic-deployment.ts` generates 5,000 Comments across three Sites and 12
Pages. It samples body lengths from a histogram of the live Comments' HTML
lengths in the local Disqus export, then fills each body with invented text.
Use `createSyntheticDeployment()` for Node benchmarks and
`seedSyntheticDeployment(db)` for Worker tests.

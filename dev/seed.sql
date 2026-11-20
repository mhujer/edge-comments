INSERT INTO site (id, name, default_language, created_at, updated_at)
VALUES ('019a0000-0000-7000-8000-000000000001', 'Development Site', 'en', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO site_origin (id, site_id, origin)
VALUES
  ('019a0000-0000-7000-8000-0000000000a1', '019a0000-0000-7000-8000-000000000001', 'http://localhost:8788'),
  ('019a0000-0000-7000-8000-0000000000a2', '019a0000-0000-7000-8000-000000000001', 'http://localhost:8791')
ON CONFLICT DO NOTHING;

INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
VALUES ('019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000001', '/', 'http://localhost:8788/', 'Comments preview', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO comment (id, page_id, parent_id, status, commenter_name, body_md, body_html, html_version, created_at, status_changed_at)
VALUES
  ('019a0000-0000-7000-8000-000000000003', '019a0000-0000-7000-8000-000000000002', NULL, 'rejected', 'Lou', 'Removed root', '<p>Removed root</p>', 1, '2026-11-18T08:00:00.000Z', '2026-11-18T08:00:00.000Z'),
  ('019a0000-0000-7000-8000-000000000004', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000003', 'published', 'Ari', 'Published reply to the removed Comment', '<p>Published reply to the removed Comment</p>', 1, '2026-11-18T08:01:00.000Z', '2026-11-18T08:01:00.000Z'),
  ('019a0000-0000-7000-8000-000000000005', '019a0000-0000-7000-8000-000000000002', NULL, 'published', 'Sam', 'Recent Thread', '<p>Recent Thread</p>', 1, '2026-11-18T09:00:00.000Z', '2026-11-18T09:00:00.000Z'),
  ('019a0000-0000-7000-8000-000000000006', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000005', 'published', 'Alex', 'Second-level reply', '<p>Second-level reply</p>', 1, '2026-11-18T09:01:00.000Z', '2026-11-18T09:01:00.000Z'),
  ('019a0000-0000-7000-8000-000000000007', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000006', 'published', 'Robin', 'Third-level reply', '<p>Third-level reply</p>', 1, '2026-11-18T09:02:00.000Z', '2026-11-18T09:02:00.000Z'),
  ('019a0000-0000-7000-8000-000000000008', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000007', 'published', 'Kim', '```
const message = "This is a deliberately long line of code to try scrolling the Comment at narrow widths.";
```', '<pre><code>const message = "This is a deliberately long line of code to try scrolling the Comment at narrow widths.";</code></pre>', 1, '2026-11-18T09:03:00.000Z', '2026-11-18T09:03:00.000Z'),
  ('019a0000-0000-7000-8000-000000000009', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000008', 'published', 'Lee', 'https://example.test/a/really/long/link/that/needs/to/wrap/on/narrow/screens', '<p><a href="https://example.test/a/really/long/link/that/needs/to/wrap/on/narrow/screens" rel="nofollow ugc noopener">https://example.test/a/really/long/link/that/needs/to/wrap/on/narrow/screens</a></p>', 1, '2026-11-18T09:04:00.000Z', '2026-11-18T09:04:00.000Z')
ON CONFLICT DO NOTHING;

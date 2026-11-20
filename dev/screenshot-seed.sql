-- Invented content for the README screenshots. Run by `npm run screenshots`.
-- Times are relative to now so the widget shows recent ages.

INSERT INTO site (id, name, default_language, created_at, updated_at)
VALUES
  ('019a0000-0000-7000-8000-000000000101', 'Personal blog', 'en', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')),
  ('019a0000-0000-7000-8000-000000000102', 'Project docs', 'en', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'));

INSERT INTO site_origin (id, site_id, origin)
VALUES
  ('019a0000-0000-7000-8000-0000000001a1', '019a0000-0000-7000-8000-000000000101', 'http://localhost:8791'),
  ('019a0000-0000-7000-8000-0000000001a2', '019a0000-0000-7000-8000-000000000102', 'https://docs.example.com');

INSERT INTO page (id, site_id, key, url, title, created_at, updated_at)
VALUES
  ('019a0000-0000-7000-8000-000000000201', '019a0000-0000-7000-8000-000000000101', '/', 'http://localhost:8791/', 'Leaving Disqus behind', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')),
  ('019a0000-0000-7000-8000-000000000202', '019a0000-0000-7000-8000-000000000101', '/notes/static-site-setup/', 'http://localhost:8791/notes/static-site-setup/', 'My static site setup', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  ('019a0000-0000-7000-8000-000000000203', '019a0000-0000-7000-8000-000000000102', '/guide/notifications/', 'https://docs.example.com/guide/notifications/', 'Notifications', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'));

INSERT INTO comment (id, page_id, parent_id, status, commenter_name, commenter_email, body_md, body_html, html_version, created_at, status_changed_at)
VALUES
  ('019a0000-0000-7000-8000-000000000301', '019a0000-0000-7000-8000-000000000201', NULL, 'published', 'Hana Novak', NULL,
   'Thanks for writing this up. I moved my blog off Disqus last year and page weight dropped by more than half.',
   '<p>Thanks for writing this up. I moved my blog off Disqus last year and page weight dropped by more than half.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days')),
  ('019a0000-0000-7000-8000-000000000302', '019a0000-0000-7000-8000-000000000201', '019a0000-0000-7000-8000-000000000301', 'published', 'Tom Becker', NULL,
   '> page weight dropped by more than half

Same here. The Disqus iframe alone pulled in a dozen trackers.',
   '<blockquote>
<p>page weight dropped by more than half</p>
</blockquote>
<p>Same here. The Disqus iframe alone pulled in a dozen trackers.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')),
  ('019a0000-0000-7000-8000-000000000303', '019a0000-0000-7000-8000-000000000201', NULL, 'published', 'Priya Raman', NULL,
   'Did you keep the old comment URLs working? Disqus links to `#comment-123` anchors.',
   '<p>Did you keep the old comment URLs working? Disqus links to <code>#comment-123</code> anchors.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('019a0000-0000-7000-8000-000000000304', '019a0000-0000-7000-8000-000000000201', '019a0000-0000-7000-8000-000000000303', 'published', 'Alex Kim', NULL,
   'The importer keeps the Disqus ID on each Comment, so you can map old anchors if you need to.',
   '<p>The importer keeps the Disqus ID on each Comment, so you can map old anchors if you need to.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '+3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '+3 hours')),
  ('019a0000-0000-7000-8000-000000000305', '019a0000-0000-7000-8000-000000000201', '019a0000-0000-7000-8000-000000000304', 'published', 'Priya Raman', NULL,
   'Nice, that covers my case. I only ever linked to whole posts anyway.',
   '<p>Nice, that covers my case. I only ever linked to whole posts anyway.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days')),
  ('019a0000-0000-7000-8000-000000000306', '019a0000-0000-7000-8000-000000000201', NULL, 'pending', 'Jonas Weber', 'jonas@example.test',
   'How does moderation work with several blogs? Is there one inbox or one per Site?',
   '<p>How does moderation work with several blogs? Is there one inbox or one per Site?</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours')),
  ('019a0000-0000-7000-8000-000000000307', '019a0000-0000-7000-8000-000000000202', NULL, 'pending', 'Elena Costa', NULL,
   'Would love a dark mode for the widget. My blog is dark and the form stands out.',
   '<p>Would love a dark mode for the widget. My blog is dark and the form stands out.</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')),
  ('019a0000-0000-7000-8000-000000000308', '019a0000-0000-7000-8000-000000000203', NULL, 'pending', 'Sam Okafor', 'sam@example.test',
   'Is there a way to get an email for every new Comment, not only the ones waiting for approval?',
   '<p>Is there a way to get an email for every new Comment, not only the ones waiting for approval?</p>
', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'));

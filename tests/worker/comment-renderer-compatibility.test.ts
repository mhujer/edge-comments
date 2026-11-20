import { expect, test } from 'vitest';
import { renderComment } from '../../src/shared/comment-renderer';

test('renders and sanitizes Comment HTML in workerd', () => {
  expect(renderComment('www.example.com <script>alert(1)</script>')).toBe(
    '<p><a href="https://www.example.com" rel="nofollow ugc noopener">www.example.com</a> &lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
  );
});

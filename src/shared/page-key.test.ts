import { describe, expect, test } from 'vitest';
import { normalizePageKey } from './page-key';

describe('normalizePageKey', () => {
  test.each([
    ['https://old.example/Guide/index.html?lang=cs#intro', '/Guide'],
    ['http://example.test:8765/Guide/index.htm/', '/Guide'],
    ['https://example.test?q=1', '/'],
    ['//Guide///Examples///', '/Guide/Examples'],
    ['/Guide/index.html/more', '/Guide/index.html/more'],
    ['/Guide/INDEX.HTML', '/Guide/INDEX.HTML'],
    ['/Guide/index.html-old', '/Guide/index.html-old'],
    ['/index.htm', '/'],
    ['///', '/'],
    ['/%2fCafe%CC%81/%69ndex.html', '/Café'],
    ['/a%2Fb%3Fc%23d/?query#fragment', '/a/b?c#d'],
    ['/plus+sign%2520', '/plus+sign%20'],
  ])('normalizes the path %s to %s', (raw, key) => {
    expect(normalizePageKey(raw, 'path')).toBe(key);
  });

  test('trims explicit keys and preserves their contents', () => {
    expect(
      normalizePageKey('  /Cafe\u0301//index.html?x=%2f#section  ', 'explicit'),
    ).toBe('/Cafe\u0301//index.html?x=%2f#section');
    expect(
      normalizePageKey('  https://example.test/?page=a  ', 'explicit'),
    ).toBe('https://example.test/?page=a');
  });

  test('limits the normalized key to 500 characters', () => {
    expect(normalizePageKey(' /' + 'a'.repeat(499) + ' ', 'explicit')).toBe(
      '/' + 'a'.repeat(499),
    );
    expect(normalizePageKey('/' + '😀'.repeat(499), 'path')).not.toBeNull();
    expect(normalizePageKey('/' + '%61'.repeat(500), 'path')).toBeNull();
    expect(normalizePageKey('a'.repeat(501), 'explicit')).toBeNull();
  });

  test('rejects an explicit key that is blank after trimming', () => {
    expect(normalizePageKey('', 'explicit')).toBeNull();
    expect(normalizePageKey(' \t ', 'explicit')).toBeNull();
    expect(normalizePageKey('', 'path')).toBe('/');
  });

  test('rejects malformed escapes in a path', () => {
    expect(normalizePageKey('/bad%FF', 'path')).toBeNull();
  });
});

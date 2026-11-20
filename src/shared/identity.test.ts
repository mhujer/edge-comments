import fc from 'fast-check';
import { expect, test } from 'vitest';
import { createId, isoTimestamp } from './identity';

test('imported Comment ids preserve the original creation millisecond', () => {
  const id = createId(0);
  expect(id).toMatch(
    /^00000000-0000-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('timestamps use UTC with milliseconds', () => {
  expect(isoTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  expect(isoTimestamp(new Date('2026-11-18T17:00:00+02:00'))).toBe(
    '2026-11-18T15:00:00.000Z',
  );
});

test('generated ids are unique UUIDv7 values whose timestamp matches the import date', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 281474976710655 }), (timestamp) => {
      const first = createId(timestamp);
      expect(first).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(Number.parseInt(first.slice(0, 8) + first.slice(9, 13), 16)).toBe(
        timestamp,
      );
      expect(createId(timestamp)).not.toBe(first);
    }),
  );
});

test('ids without an import date use the current time', () => {
  const before = Date.now();
  const id = createId();
  const millis = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  expect(millis).toBeGreaterThanOrEqual(before);
  expect(millis).toBeLessThanOrEqual(Date.now());
});

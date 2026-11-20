import { v7 } from 'uuid';

/** Optional Unix milliseconds preserve imported Comments' original creation time. */
export function createId(timestamp?: number): string {
  return timestamp === undefined ? v7() : v7({ msecs: timestamp });
}

export function isoTimestamp(timestamp: number | Date = Date.now()): string {
  return new Date(timestamp).toISOString();
}

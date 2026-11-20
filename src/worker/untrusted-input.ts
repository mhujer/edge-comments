export function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export const LANGUAGES = ['cs', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const MODERATION_MODES = [
  'approve_first',
  'publish_immediately',
] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

export function isModerationMode(value: unknown): value is ModerationMode {
  return MODERATION_MODES.some((mode) => mode === value);
}

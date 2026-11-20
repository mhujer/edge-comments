import { commentTime } from '../shared/comment-time';
import type { Language } from '../shared/public-comments';

const copy = {
  cs: {
    counts: { one: 'komentář', few: 'komentáře', other: 'komentářů' },
    removed: 'Komentář odstraněn',
    name: 'Jméno',
    email: 'E-mail (nikdy se nezobrazuje)',
    body: 'Komentář',
    editorMode: 'Režim editoru komentáře',
    write: 'Napsat',
    preview: 'Náhled',
    syntaxHint:
      'Markdown — `kód`, blok kódu (``` na samostatných řádcích), > citace, **tučně**, *kurzíva*, https://example.com',
    previewLoading: 'Načítám náhled…',
    previewFailed: 'Náhled se nepodařilo načíst.',
    post: 'Odeslat',
    reply: '↩ Odpovědět',
    replyingTo: (name: string) => `↩ Odpověď pro ${name}`,
    cancel: '✕ Zrušit',
    pending: 'Čeká na schválení',
    pendingNote: 'Komentář byl odeslán. Zobrazí se tu po schválení.',
    errors: {
      invalid_name: 'Zadejte jméno o délce 1 až 100 znaků.',
      invalid_email: 'Zadejte platnou e-mailovou adresu.',
      body_empty: 'Napište komentář.',
      body_too_long: 'Komentář může mít nejvýše 20 000 znaků.',
      parent_invalid: 'Na tento komentář už nelze odpovědět.',
      origin_not_allowed: 'Z této stránky nelze odesílat komentáře.',
      rate_limited:
        'Příliš mnoho požadavků. Chvíli počkejte a zkuste to znovu.',
      turnstile_failed: 'Ověření se nezdařilo. Zkuste to znovu.',
      unsupported_media_type: 'Formát požadavku není podporován.',
      not_found: 'Stránku se nepodařilo najít.',
    },
    submissionFailed: 'Komentář se nepodařilo odeslat.',

    inReplyTo: (name: string) => `odpověď pro ${name}`,
    inReplyToRemoved: 'odpověď na odstraněný komentář',
    loadFailed: 'Komentáře se nepodařilo načíst.',
  },
  en: {
    counts: { one: 'comment', few: 'comments', other: 'comments' },
    removed: 'Comment removed',
    name: 'Name',
    email: 'Email (never shown)',
    body: 'Comment',
    editorMode: 'Comment editor mode',
    write: 'Write',
    preview: 'Preview',
    syntaxHint:
      'Markdown — `code`, fenced block (``` on separate lines), > quote, **bold**, *italic*, https://example.com',
    previewLoading: 'Loading preview…',
    previewFailed: 'The preview could not be loaded.',
    post: 'Post',
    reply: '↩ Reply',
    replyingTo: (name: string) => `↩ Replying to ${name}`,
    cancel: '✕ Cancel',
    pending: 'Awaiting approval',
    pendingNote:
      "Your comment was sent. It will appear here once it's approved.",
    errors: {
      invalid_name: 'Enter a name between 1 and 100 characters.',
      invalid_email: 'Enter a valid email address.',
      body_empty: 'Write a comment.',
      body_too_long: 'Use no more than 20,000 characters.',
      parent_invalid: 'You can no longer reply to this comment.',
      origin_not_allowed: 'Comments cannot be submitted from this page.',
      rate_limited: 'Too many requests. Wait a moment and try again.',
      turnstile_failed: 'Verification failed. Try again.',
      unsupported_media_type: 'This request format is unsupported.',
      not_found: 'The page could not be found.',
    },
    submissionFailed: 'The comment could not be posted.',

    inReplyTo: (name: string) => `in reply to ${name}`,
    inReplyToRemoved: 'in reply to a removed comment',
    loadFailed: 'Comments could not be loaded.',
  },
};

export function widgetStrings(language: Language, now = Date.now()) {
  const labels = copy[language];
  const plural = new Intl.PluralRules(language);

  return {
    ...labels,
    count(value: number) {
      const form = plural.select(value);
      return `${value} ${labels.counts[form === 'one' || form === 'few' ? form : 'other']}`;
    },
    ...commentTime(language, now),
  };
}

export type WidgetStrings = ReturnType<typeof widgetStrings>;

export function formError(
  strings: WidgetStrings,
  code?: string,
  fallback = strings.submissionFailed,
): string {
  return code && Object.hasOwn(strings.errors, code)
    ? strings.errors[code as keyof WidgetStrings['errors']]
    : fallback;
}

export const MAX_NAME_CHARACTERS = 100;
export const MAX_BODY_CHARACTERS = 20_000;

/** Shown when a Commenter's name is missing, such as on imported Comments. */
export const ANONYMOUS_NAME = 'Anonymous';

export function validCommentName(name: string): boolean {
  return name.length > 0 && [...name].length <= MAX_NAME_CHARACTERS;
}

export function validCommentEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email);
}

type BodyValidation =
  | { ok: true; body: string }
  | { ok: false; code: 'body_empty' | 'body_too_long' };

/** Validate a submission or preview and return the trimmed Markdown to render. */
export function validateCommentBody(input: string): BodyValidation {
  const body = input.trim();
  if (body.length === 0) return { ok: false, code: 'body_empty' };

  // A Unicode code point can occupy two UTF-16 code units.
  if (
    body.length > 2 * MAX_BODY_CHARACTERS ||
    (body.length > MAX_BODY_CHARACTERS &&
      [...body].length > MAX_BODY_CHARACTERS)
  ) {
    return { ok: false, code: 'body_too_long' };
  }

  return { ok: true, body };
}

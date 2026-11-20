import type { WorkerBindings } from './bindings';

export interface PlainTextEmail {
  subject: string;
  text: string;
}

/** Make a supplied string safe for one line of a plain-text email or its subject. */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, '').trim();
}

/** Keep line breaks and tabs in a multi-line supplied string, but strip every other control character. */
export function stripControlCharactersKeepingLines(value: string): string {
  return value
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/[^\P{Cc}\n\t]|\p{Bidi_Control}/gu, '');
}

export async function sendAdminEmail(
  env: Pick<WorkerBindings, 'EMAIL' | 'ADMIN_EMAIL' | 'EMAIL_FROM'>,
  { subject, text }: PlainTextEmail,
): Promise<void> {
  await env.EMAIL.send({
    from: { name: 'edge-comments', email: env.EMAIL_FROM },
    to: env.ADMIN_EMAIL,
    subject,
    text,
  });
}

export function emailErrorCode(error: unknown): string {
  // The service's error message can contain parts of the email.
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^E_[A-Z_]+$/.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof TypeError ? 'TypeError' : 'Error';
}

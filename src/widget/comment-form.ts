import {
  validCommentEmail,
  validCommentName,
  validateCommentBody,
} from '../shared/comment-input';
import { escapeHtml } from '../shared/escape-html';
import type {
  SubmissionRequest,
  SubmissionResponse,
} from '../shared/public-comments';
import { readStorage, writeStorage } from './storage';
import { formError, type WidgetStrings } from './strings';
import { loadTurnstile } from './turnstile';

type FormOptions = {
  url: URL;
  page: Pick<SubmissionRequest, 'page' | 'pageType'>;
  siteKey: string;
  strings: WidgetStrings;
  onSuccess: (response: SubmissionResponse) => void;
  reply?: { id: string; name: string; cancel: () => void };
};

export function createCommentForm({
  url,
  page,
  siteKey,
  strings,
  onSuccess,
  reply,
}: FormOptions) {
  const form = document.createElement('form');
  form.className = reply
    ? 'edge-comments-form edge-comments-reply-form'
    : 'edge-comments-form';
  form.noValidate = true;
  const hintId = reply ? 'edge-comments-reply-hint' : 'edge-comments-hint';
  form.innerHTML = `
    ${
      reply
        ? `<header class="edge-comments-reply-header">
      <strong>${escapeHtml(strings.replyingTo(reply.name))}</strong>
      <button type="button" class="edge-comments-cancel">${escapeHtml(strings.cancel)}</button>
    </header>`
        : ''
    }
    <div class="edge-comments-fields">
      <label>${escapeHtml(strings.name)}<input name="name" autocomplete="name" required></label>
      <label>${escapeHtml(strings.email)}<input type="email" name="email" autocomplete="email"></label>
    </div>
    <div class="edge-comments-modes" role="group" aria-label="${escapeHtml(strings.editorMode)}">
      <button type="button" data-mode="write" aria-pressed="true">${escapeHtml(strings.write)}</button>
      <button type="button" data-mode="preview" aria-pressed="false">${escapeHtml(strings.preview)}</button>
    </div>
    <div class="edge-comments-editor">
      <label>${escapeHtml(strings.body)}<textarea name="body" rows="4" required aria-describedby="${hintId}"></textarea></label>
      <p class="edge-comments-hint" id="${hintId}">${escapeHtml(strings.syntaxHint)}</p>
    </div>
    <div class="edge-comments-preview" hidden>
      <p class="edge-comments-preview-status" role="status"></p>
      <div class="edge-comments-body"></div>
    </div>
    <div hidden aria-hidden="true"><input name="website" autocomplete="off" tabindex="-1"></div>
    <div class="edge-comments-turnstile"></div>
    <p class="edge-comments-error" role="alert" hidden></p>
    <button type="submit" class="edge-comments-post" disabled>${escapeHtml(strings.post)}</button>
  `;

  const nameInput = form.querySelector<HTMLInputElement>('[name="name"]')!;
  const emailInput = form.querySelector<HTMLInputElement>('[name="email"]')!;
  const bodyInput = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const editor = form.querySelector<HTMLElement>('.edge-comments-editor')!;
  const writeButton = form.querySelector<HTMLButtonElement>(
    '[data-mode="write"]',
  )!;
  const previewButton = form.querySelector<HTMLButtonElement>(
    '[data-mode="preview"]',
  )!;
  const preview = form.querySelector<HTMLElement>('.edge-comments-preview')!;
  const previewBody = preview.querySelector<HTMLElement>(
    '.edge-comments-body',
  )!;
  const previewStatus = preview.querySelector<HTMLElement>('[role="status"]')!;
  const website = form.querySelector<HTMLInputElement>('[name="website"]')!;
  const challenge = form.querySelector<HTMLElement>(
    '.edge-comments-turnstile',
  )!;
  const alert = form.querySelector<HTMLElement>('.edge-comments-error')!;
  const post = form.querySelector<HTMLButtonElement>('[type="submit"]')!;

  nameInput.value = readStorage('name') ?? '';
  emailInput.value = readStorage('email') ?? '';
  if (reply) {
    form
      .querySelector('.edge-comments-cancel')
      ?.addEventListener('click', reply.cancel);
  }

  let token = '';
  let submitting = false;
  let rendering = false;
  let previewRequest: AbortController | undefined;
  let removeChallenge: (() => void) | undefined;
  let resetChallenge: (() => void) | undefined;

  function updatePost() {
    post.disabled = !token || submitting;
  }

  function showError(code?: string) {
    alert.textContent = formError(strings, code);
    alert.hidden = false;
  }

  function clearToken() {
    token = '';
    updatePost();
  }

  function setPreviewMode(active: boolean) {
    editor.hidden = active;
    preview.hidden = !active;
    writeButton.setAttribute('aria-pressed', String(!active));
    previewButton.setAttribute('aria-pressed', String(active));
  }

  function showWrite() {
    previewRequest?.abort();
    previewRequest = undefined;
    setPreviewMode(false);
    previewBody.replaceChildren();
    previewStatus.textContent = '';
  }

  function focusBody() {
    showWrite();
    bodyInput.focus();
  }

  async function showPreview() {
    if (!preview.hidden) return;
    alert.hidden = true;
    const body = validateCommentBody(bodyInput.value);
    if (!body.ok) {
      showError(body.code);
      bodyInput.focus();
      return;
    }
    setPreviewMode(true);
    previewStatus.textContent = strings.previewLoading;
    const request = new AbortController();
    previewRequest = request;
    try {
      const response = await fetch(new URL('/api/preview', url), {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.body }),
        signal: request.signal,
      });
      if (!response.ok) {
        const error = await response.json<{ error?: { code?: string } }>();
        if (!request.signal.aborted) {
          previewStatus.textContent = formError(
            strings,
            error.error?.code,
            strings.previewFailed,
          );
        }
        return;
      }
      const result = await response.json<{ html: string }>();
      if (request.signal.aborted) return;
      previewStatus.textContent = '';
      previewBody.innerHTML = result.html;
    } catch {
      if (!request.signal.aborted)
        previewStatus.textContent = strings.previewFailed;
    } finally {
      if (previewRequest === request) previewRequest = undefined;
    }
  }

  async function renderChallenge() {
    if (rendering || removeChallenge) return;
    rendering = true;
    try {
      const turnstile = await loadTurnstile();
      if (!form.isConnected) return;
      const widgetId = turnstile.render(challenge, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        'response-field': false,
        callback: (value) => {
          token = value;
          updatePost();
        },
        'expired-callback': clearToken,
        'error-callback': () => {
          clearToken();
          showError('turnstile_failed');
        },
        'timeout-callback': clearToken,
      });
      removeChallenge = () => turnstile.remove(widgetId);
      resetChallenge = () => turnstile.reset(widgetId);
    } catch {
      showError('turnstile_failed');
    } finally {
      rendering = false;
    }
  }

  writeButton.addEventListener('click', focusBody);
  previewButton.addEventListener('click', () => void showPreview());
  form.addEventListener('focusin', () => void renderChallenge());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit() {
    if (!token || submitting) return;
    alert.hidden = true;
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!validCommentName(name)) {
      showError('invalid_name');
      nameInput.focus();
      return;
    }
    if (email && !validCommentEmail(email)) {
      showError('invalid_email');
      emailInput.focus();
      return;
    }
    const body = validateCommentBody(bodyInput.value);
    if (!body.ok) {
      showError(body.code);
      focusBody();
      return;
    }

    const payload: SubmissionRequest = {
      ...page,
      url: location.href,
      title: document.title,
      parentId: reply?.id,
      name,
      email: email || undefined,
      body: body.body,
      turnstileToken: token,
      website: website.value,
    };
    submitting = true;
    clearToken();
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json<{ error?: { code?: string } }>();
        showError(error.error?.code);
        return;
      }
      const result = await response.json<SubmissionResponse>();
      writeStorage('name', name);
      writeStorage('email', email);
      // Keep edits made while the previous submission was in flight.
      if (bodyInput.value.trim() === body.body) {
        bodyInput.value = '';
        showWrite();
      }
      onSuccess(result);
    } catch {
      showError();
    } finally {
      submitting = false;
      resetChallenge?.();
      updatePost();
    }
  }

  return {
    element: form,
    focusBody,
    releaseChallenge() {
      removeChallenge?.();
      removeChallenge = resetChallenge = undefined;
      clearToken();
    },
  };
}

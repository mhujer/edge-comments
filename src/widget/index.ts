import type {
  CommentsResponse,
  SubmissionResponse,
  VisibleComment,
} from '../shared/public-comments';
import { isLanguage } from '../shared/site-settings';
import { createCommentForm } from './comment-form';
import { widgetStrings, type WidgetStrings } from './strings';
import { renderThreadList } from './thread-renderer';
import css from './widget.css';

function showComments(
  root: HTMLElement,
  comments: readonly VisibleComment[],
  strings: WidgetStrings,
  options: Pick<
    Parameters<typeof createCommentForm>[0],
    'url' | 'page' | 'siteKey'
  >,
) {
  const visible = new Map(comments.map((comment) => [comment.id, comment]));
  const count = document.createElement('h2');
  count.className = 'edge-comments-count';
  const list = document.createElement('div');
  let activeReply:
    | {
        id: string;
        form: ReturnType<typeof createCommentForm>;
      }
    | undefined;

  function commentElement(id: string) {
    return list.querySelector<HTMLElement>(
      `#${CSS.escape('edge-comments-comment-' + id)}`,
    );
  }

  function render() {
    const { count: total, threads } = renderThreadList(
      [...visible.values()],
      strings,
    );
    activeReply?.form.releaseChallenge();
    list.innerHTML = threads;
    count.textContent = strings.count(total);
    if (activeReply) {
      const parent = commentElement(activeReply.id);
      parent?.parentNode?.insertBefore(
        activeReply.form.element,
        parent.nextSibling,
      );
    }
  }

  function closeReply(restoreFocus = false) {
    if (!activeReply) return;
    const { form, id } = activeReply;
    activeReply = undefined;
    form.releaseChallenge();
    form.element.remove();
    if (restoreFocus) {
      commentElement(id)
        ?.querySelector<HTMLButtonElement>('.edge-comments-reply')
        ?.focus();
    }
  }

  function onSuccess({ comment }: SubmissionResponse) {
    const { status, ...content } = comment;
    visible.set(
      comment.id,
      status === 'pending' ? { ...content, status } : content,
    );
    render();
  }

  const top = createCommentForm({ ...options, strings, onSuccess });
  root.replaceChildren(count, top.element, list);
  render();

  list.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>(
      'button[data-edge-comments-parent], button[data-edge-comments-reply]',
    );
    if (!button) return;

    const parentId = button.dataset.edgeCommentsParent;
    if (parentId) {
      const parent = list.querySelector<HTMLElement>(
        `#${CSS.escape(parentId)}`,
      );
      if (!parent) return;
      list
        .querySelector('.edge-comments-highlighted')
        ?.classList.remove('edge-comments-highlighted');
      parent.classList.add('edge-comments-highlighted');
      parent.focus({ preventScroll: true });
      parent.scrollIntoView({ block: 'center' });
      return;
    }

    const id = button.dataset.edgeCommentsReply;
    if (!id) return;
    const comment = visible.get(id);
    if (!comment || 'removed' in comment || 'status' in comment) return;
    if (activeReply?.id === id) {
      activeReply.form.focusBody();
      return;
    }

    closeReply();
    const form = createCommentForm({
      ...options,
      strings,
      reply: { id, name: comment.name, cancel: () => closeReply(true) },
      onSuccess(result) {
        if (activeReply?.form === form) closeReply();
        onSuccess(result);
      },
    });
    activeReply = { id, form };
    const parent = commentElement(id);
    parent?.parentNode?.insertBefore(form.element, parent.nextSibling);
    form.focusBody();
  });
}

async function mountWidget(root: HTMLElement, scriptUrl: string) {
  root.classList.add('edge-comments-widget');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const languageOverride = isLanguage(root.dataset.lang)
    ? root.dataset.lang
    : undefined;
  const page = root.dataset.pageKey ?? location.pathname;
  const pageType = root.dataset.pageKey === undefined ? undefined : 'explicit';
  const url = new URL('/api/comments', scriptUrl);
  const listUrl = new URL(url);
  listUrl.searchParams.set('page', page);
  if (pageType !== undefined) listUrl.searchParams.set('pageType', pageType);

  root.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(listUrl, { credentials: 'omit' });
    if (!response.ok) throw new Error('Comments request failed');
    const { comments, site } = await response.json<CommentsResponse>();
    const language = languageOverride ?? site.language;
    root.lang = language;
    showComments(root, comments, widgetStrings(language), {
      url,
      page: { page, pageType },
      siteKey: site.turnstileSiteKey,
    });
  } catch {
    const language =
      languageOverride ??
      (document.documentElement.lang === 'cs' ? 'cs' : 'en');
    root.lang = language;
    root.textContent = widgetStrings(language).loadFailed;
  } finally {
    root.removeAttribute('aria-busy');
  }
}

const root = document.getElementById('edge-comments');
const script = document.currentScript;
if (root && script instanceof HTMLScriptElement) {
  void mountWidget(root, script.src);
}

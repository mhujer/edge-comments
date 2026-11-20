import { escapeHtml } from '../shared/escape-html';
import type { VisibleComment } from '../shared/public-comments';
import type { WidgetStrings } from './strings';

const commentId = (id: string) => escapeHtml('edge-comments-comment-' + id);

function oldestFirst(a: VisibleComment, b: VisibleComment) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function renderCommentItem(
  comment: VisibleComment,
  depth: number,
  strings: WidgetStrings,
  parent?: VisibleComment,
  replies = '',
): string {
  let reference = '';
  if (parent) {
    const label =
      'removed' in parent
        ? strings.inReplyToRemoved
        : strings.inReplyTo(parent.name);
    reference = `<button type="button" class="edge-comments-reference" data-edge-comments-parent="${commentId(parent.id)}">↪ ${escapeHtml(label)}</button>`;
  }

  const pending = 'status' in comment;
  const content =
    'removed' in comment
      ? `<p class="edge-comments-removed">${escapeHtml(strings.removed)}</p>`
      : `<header class="edge-comments-meta">
        <span class="edge-comments-name">${escapeHtml(comment.name)}</span>
        <span aria-hidden="true">·</span>
        <time datetime="${escapeHtml(comment.createdAt)}" title="${escapeHtml(strings.fullDate(comment.createdAt))}">${escapeHtml(strings.relativeDate(comment.createdAt))}</time>
      </header>
      ${pending ? `<span class="edge-comments-pending-badge">${escapeHtml(strings.pending)}</span>` : ''}
      <div class="edge-comments-body">${comment.html}</div>
      ${
        pending
          ? `<p class="edge-comments-pending-note">${escapeHtml(strings.pendingNote)}</p>`
          : `<button type="button" class="edge-comments-reply" data-edge-comments-reply="${escapeHtml(comment.id)}">${escapeHtml(strings.reply)}</button>`
      }`;

  return `<div class="edge-comments-node edge-comments-depth-${depth}">
    <div id="${commentId(comment.id)}" class="edge-comments-comment${pending ? ' edge-comments-pending' : ''}" tabindex="-1">${reference}${content}</div>
    ${replies}
  </div>`;
}

export function renderThreadList(
  comments: readonly VisibleComment[],
  strings: WidgetStrings,
) {
  const children = new Map<string | null, VisibleComment[]>();
  const byId = new Map<string, VisibleComment>();
  let count = 0;

  for (const comment of comments) {
    byId.set(comment.id, comment);
  }

  for (const comment of comments) {
    const parentId =
      comment.parentId && byId.has(comment.parentId) ? comment.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(comment);
    else children.set(parentId, [comment]);
    if (!('removed' in comment)) count++;
  }

  function renderBranch(comment: VisibleComment, depth: number): string {
    let replies = '';
    const directReplies = children.get(comment.id);
    if (directReplies?.length) {
      if (depth === 2) {
        // Keep every deeper reply at level three, in time order under this branch.
        const flattened = [...directReplies];
        for (const reply of flattened) {
          const descendants = children.get(reply.id);
          if (descendants) flattened.push(...descendants);
        }
        replies = flattened
          .sort(oldestFirst)
          .map((reply) => {
            const parent =
              reply.parentId !== null && reply.parentId !== comment.id
                ? byId.get(reply.parentId)
                : undefined;
            return renderCommentItem(reply, 3, strings, parent);
          })
          .join('');
      } else {
        replies = directReplies
          .sort(oldestFirst)
          .map((reply) => renderBranch(reply, depth + 1))
          .join('');
      }
      replies = `<div class="edge-comments-replies">${replies}</div>`;
    }
    return renderCommentItem(comment, depth, strings, undefined, replies);
  }

  const threads = (children.get(null) ?? [])
    .sort((a, b) => oldestFirst(b, a))
    .map(
      (root) =>
        `<article class="edge-comments-thread">${renderBranch(root, 1)}</article>`,
    )
    .join('');

  return { count, threads };
}

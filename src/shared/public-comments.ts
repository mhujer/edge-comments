import type { Language } from './site-settings';

export type { Language };

type CommentMetadata = {
  id: string;
  parentId: string | null;
  createdAt: string;
};

export type CommentContent = CommentMetadata & {
  name: string;
  html: string;
};

export type PublicComment =
  CommentContent | (CommentMetadata & { removed: true });

export type VisibleComment = PublicComment | PendingComment;

export type CommentsResponse = {
  site: { language: Language; turnstileSiteKey: string };
  comments: PublicComment[];
};

export type SubmittedComment = CommentContent & {
  status: 'pending' | 'published';
};

export type PendingComment = CommentContent & { status: 'pending' };
export type SubmissionResponse = { comment: SubmittedComment };

export type SubmissionRequest = {
  page: string;
  pageType?: 'explicit';
  url: string;
  title: string;
  parentId?: string;
  name: string;
  email?: string;
  body: string;
  turnstileToken: string;
  website: string;
};

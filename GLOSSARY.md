# edge-comments

A lightweight, self-hosted comment system that one Admin deploys to serve comments on several of their own websites.

## Language

**Site**:
One website that embeds comments. A single deployment serves many Sites, all owned by the same Admin. Each Site has a name chosen by the Admin to tell Sites apart; Commenters never see it.
_Avoid_: Domain, tenant, property

**Allowed origin**:
An origin (scheme, host and port) from which a Site's pages may load and submit Comments. Each Allowed origin belongs to exactly one Site.
_Avoid_: Domain, whitelist, hostname

**Page**:
One commentable page of a Site, identified by a stable key. It holds all the Comments shown there.
_Avoid_: Thread (Disqus's word for this), post, article, URL

**Page key**:
The stable identifier of a Page within its Site, derived from the page's path unless set explicitly.
_Avoid_: Slug, identifier, URL

**Thread**:
A top-level Comment together with all its replies, at any depth.
_Avoid_: Conversation, discussion

**Comment**:
One message written by a Commenter, either at the top level of a Page or as a reply to another Comment.
_Avoid_: Post, message

**Pending Comment**:
A Comment awaiting Admin approval. It isn't shown to readers. Its Commenter sees it only right after submitting it, until they leave or reload the page.
_Avoid_: Draft, unapproved comment, shadow comment

**Commenter**:
A visitor who writes a Comment.
_Avoid_: User, author, guest

**Admin**:
The person who operates the deployment, configures Sites and moderates Comments.
_Avoid_: Operator, owner, moderator, tenant, self-hoster

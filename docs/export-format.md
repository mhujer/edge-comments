# JSON export format

The Tools tab downloads one UTF-8 JSON document containing all Sites, Pages and stored Comments in the deployment. The same format is used for R2 backups.

## Document

| Field         | Type                  | Meaning                                                |
| ------------- | --------------------- | ------------------------------------------------------ |
| `format`      | String                | Always `edge-comments-export`.                         |
| `version`     | Integer               | Format version, currently `1`.                         |
| `exported_at` | String                | UTC timestamp of export generation in ISO 8601 format. |
| `sites`       | Array of Site objects | Every Site in the deployment.                          |

## Site

| Field              | Type                  | Meaning                                                                                               |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`               | UUID string           | Site ID.                                                                                              |
| `name`             | String                | Site name.                                                                                            |
| `moderation_mode`  | String                | `approve_first` queues new Comments for approval. `publish_immediately` publishes them on submission. |
| `default_language` | String                | Default widget language, `cs` (Czech) or `en` (English).                                              |
| `origins`          | Array of strings      | Allowed origins, each containing a scheme, host and any non-default port.                             |
| `pages`            | Array of Page objects | Pages belonging to this Site.                                                                         |

## Page

| Field        | Type                     | Meaning                                                                 |
| ------------ | ------------------------ | ----------------------------------------------------------------------- |
| `id`         | UUID string              | Page ID.                                                                |
| `key`        | String                   | Stable Page key within the Site.                                        |
| `url`        | String                   | Stored Page URL.                                                        |
| `title`      | String                   | Stored Page title.                                                      |
| `created_at` | String                   | UTC timestamp when the Page was created, in ISO 8601 format.            |
| `comments`   | Array of Comment objects | Flat list of Comments on this Page, including Comments in every status. |

## Comment

| Field               | Type                | Meaning                                                                                                                   |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                | UUID string         | Comment ID.                                                                                                               |
| `parent_id`         | UUID string or null | ID of the parent Comment in the Page's flat list, or `null` for a top-level Comment. Rejected parents remain in the list. |
| `status`            | String              | `pending`, `published` or `rejected`.                                                                                     |
| `commenter_name`    | String              | Commenter's display name.                                                                                                 |
| `commenter_email`   | String or null      | Commenter's stored email address, or `null` when absent.                                                                  |
| `body_md`           | String              | Stored Markdown source.                                                                                                   |
| `external_id`       | String or null      | Source ID for imported Comments, such as `disqus:123`, or `null` when absent.                                             |
| `created_at`        | String              | UTC timestamp when the Comment was written, in ISO 8601 format.                                                           |
| `status_changed_at` | String              | UTC timestamp of the last status change, in ISO 8601 format. Initially set to `created_at`.                               |

Empty collections are represented by `[]`.

## Versioning

The integer `version` increases only for breaking changes to the document format. Readers of version 1 should accept additional fields.

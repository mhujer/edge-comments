CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_id` text,
	`status` text NOT NULL,
	`commenter_name` text NOT NULL,
	`commenter_email` text,
	`body_md` text NOT NULL,
	`body_html` text NOT NULL,
	`html_version` integer NOT NULL,
	`external_id` text,
	`created_at` text NOT NULL,
	`status_changed_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_external_id_unique` ON `comment` (`external_id`);--> statement-breakpoint
CREATE INDEX `comment_page_status_created_idx` ON `comment` (`page_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_status_created_id_idx` ON `comment` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `comment_parent_idx` ON `comment` (`parent_id`);--> statement-breakpoint
CREATE TABLE `page` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`key` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_site_key_unique` ON `page` (`site_id`,`key`);--> statement-breakpoint
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`moderation_mode` text DEFAULT 'approve_first' NOT NULL,
	`default_language` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_origin` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`origin` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_origin_origin_unique` ON `site_origin` (`origin`);
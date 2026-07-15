CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`temperature` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `profile` (`id`, `name`, `created_at`) VALUES ('personal', 'personal', 0);
--> statement-breakpoint
ALTER TABLE `session` RENAME TO `conversation`;
--> statement-breakpoint
ALTER TABLE `conversation` ADD `profile_id` text DEFAULT 'personal' NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_fact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_fact` (`id`, `profile_id`, `category`, `text`, `created_at`)
SELECT `id`, 'personal', `category`, `text`, `created_at` FROM `fact`;
--> statement-breakpoint
DROP TABLE `fact`;
--> statement-breakpoint
ALTER TABLE `__new_fact` RENAME TO `fact`;
--> statement-breakpoint
CREATE TABLE `__new_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_source` (`id`, `profile_id`, `path`, `created_at`)
SELECT `id`, 'personal', `path`, `created_at` FROM `source`;
--> statement-breakpoint
DROP TABLE `source`;
--> statement-breakpoint
ALTER TABLE `__new_source` RENAME TO `source`;
--> statement-breakpoint
CREATE UNIQUE INDEX `source_profile_path` ON `source` (`profile_id`,`path`);
--> statement-breakpoint
CREATE TABLE `__new_conversation_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_index` integer,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`summarizer_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_item` (`id`, `conversation_id`, `turn_index`, `kind`, `payload`, `input_tokens`, `cached_input_tokens`, `output_tokens`, `summarizer_tokens`, `created_at`)
SELECT `id`, `session_id`, `turn_index`, `kind`, `payload`, `input_tokens`, `cached_input_tokens`, `output_tokens`, `summarizer_tokens`, `created_at` FROM `conversation_item`;
--> statement-breakpoint
DROP TABLE `conversation_item`;
--> statement-breakpoint
ALTER TABLE `__new_conversation_item` RENAME TO `conversation_item`;
--> statement-breakpoint
CREATE INDEX `conversation_item_conversation_turn` ON `conversation_item` (`conversation_id`,`turn_index`);
--> statement-breakpoint
CREATE INDEX `conversation_item_conversation_kind_id` ON `conversation_item` (`conversation_id`,`kind`,`id`);

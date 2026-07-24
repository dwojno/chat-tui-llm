CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversation_item` (
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
CREATE INDEX `conversation_item_conversation_turn` ON `conversation_item` (`conversation_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `conversation_item_conversation_kind_id` ON `conversation_item` (`conversation_id`,`kind`,`id`);--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`label` text NOT NULL,
	`transport` text NOT NULL,
	`url` text,
	`command` text,
	`args` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_profile_label` ON `mcp_server` (`profile_id`,`label`);--> statement-breakpoint
CREATE TABLE `memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`path` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`s3_key` text,
	`content_hash` text,
	`chunk_count` integer,
	`indexed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_profile_path` ON `source` (`profile_id`,`path`);
CREATE TABLE `usage_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_record_conversation` ON `usage_record` (`conversation_id`);--> statement-breakpoint
ALTER TABLE `conversation_item` DROP COLUMN `input_tokens`;--> statement-breakpoint
ALTER TABLE `conversation_item` DROP COLUMN `cached_input_tokens`;--> statement-breakpoint
ALTER TABLE `conversation_item` DROP COLUMN `output_tokens`;--> statement-breakpoint
ALTER TABLE `conversation_item` DROP COLUMN `summarizer_tokens`;
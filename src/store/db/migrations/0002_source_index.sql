ALTER TABLE `source` ADD `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `source` ADD `s3_key` text;
--> statement-breakpoint
ALTER TABLE `source` ADD `content_hash` text;
--> statement-breakpoint
ALTER TABLE `source` ADD `chunk_count` integer;
--> statement-breakpoint
ALTER TABLE `source` ADD `indexed_at` integer;

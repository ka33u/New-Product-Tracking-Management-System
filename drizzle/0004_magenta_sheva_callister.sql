CREATE TABLE `npd_local_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npd_local_sessions_token_hash_unique` ON `npd_local_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_npd_local_sessions_user` ON `npd_local_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `npd_users` ADD `password_salt` text;--> statement-breakpoint
ALTER TABLE `npd_users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `npd_users` ADD `last_login_at` text;
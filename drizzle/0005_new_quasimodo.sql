CREATE TABLE `npd_local_login_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempt_count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_npd_login_limits_expiry` ON `npd_local_login_limits` (`window_started_at`);
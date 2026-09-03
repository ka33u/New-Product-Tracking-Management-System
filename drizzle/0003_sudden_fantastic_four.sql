CREATE TABLE `npd_sheet_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sheet_code` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`planned_date` text NOT NULL,
	`actor_id` text NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_sheet_revisions_version` ON `npd_sheet_revisions` (`project_id`,`sheet_code`,`version`);--> statement-breakpoint
CREATE INDEX `idx_npd_sheet_revisions_timeline` ON `npd_sheet_revisions` (`project_id`,`sheet_code`,`created_at`);--> statement-breakpoint
ALTER TABLE `npd_inspection_records` ADD `requirement_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_part_items` ADD `design_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `terminal_mode` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `protection_grade` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `insulation_class` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `cooling_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `design_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_test_reports` ADD `requirement_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `npd_users` ADD `auth_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `npd_users_auth_user_id_unique` ON `npd_users` (`auth_user_id`);
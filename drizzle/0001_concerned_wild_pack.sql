CREATE TABLE `npd_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text DEFAULT 'project' NOT NULL,
	`entity_id` text,
	`detail` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_npd_activities_project_time` ON `npd_activities` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_npd_activities_actor_time` ON `npd_activities` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `npd_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`industry` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npd_customers_code_unique` ON `npd_customers` (`code`);--> statement-breakpoint
CREATE TABLE `npd_dashboard_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `npd_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sheet_code` text NOT NULL,
	`motor_id` text,
	`linked_record_id` text,
	`kind` text DEFAULT 'attachment' NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`version` text DEFAULT 'A1' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `npd_project_motors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_npd_documents_project_sheet` ON `npd_documents` (`project_id`,`sheet_code`);--> statement-breakpoint
CREATE INDEX `idx_npd_documents_record` ON `npd_documents` (`linked_record_id`);--> statement-breakpoint
CREATE TABLE `npd_form_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_code` text NOT NULL,
	`sheet_code` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_forms_project_form` ON `npd_form_records` (`project_id`,`form_code`);--> statement-breakpoint
CREATE INDEX `idx_npd_forms_project_sheet` ON `npd_form_records` (`project_id`,`sheet_code`);--> statement-breakpoint
CREATE TABLE `npd_inspection_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`motor_id` text,
	`part_item_id` text,
	`item_type` text NOT NULL,
	`inspection_requirement` text NOT NULL,
	`design_output_ref` text DEFAULT '' NOT NULL,
	`inspection_date` text NOT NULL,
	`result` text NOT NULL,
	`conclusion` text DEFAULT '' NOT NULL,
	`document_id` text,
	`inspector_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `npd_project_motors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_item_id`) REFERENCES `npd_part_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `npd_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_npd_inspections_project_date` ON `npd_inspection_records` (`project_id`,`inspection_date`);--> statement-breakpoint
CREATE INDEX `idx_npd_inspections_motor_part` ON `npd_inspection_records` (`motor_id`,`part_item_id`);--> statement-breakpoint
CREATE TABLE `npd_part_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`motor_id` text,
	`part_no` text NOT NULL,
	`name` text NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`source_type` text DEFAULT '自制' NOT NULL,
	`design_output_ref` text DEFAULT '' NOT NULL,
	`inspection_requirement` text DEFAULT '' NOT NULL,
	`test_requirement` text DEFAULT '' NOT NULL,
	`planned_date` text NOT NULL,
	`actual_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `npd_project_motors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_parts_project_no_motor` ON `npd_part_items` (`project_id`,`part_no`,`motor_id`);--> statement-breakpoint
CREATE INDEX `idx_npd_parts_project_status` ON `npd_part_items` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `npd_project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`responsibility` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_members_project_user` ON `npd_project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_npd_members_user` ON `npd_project_members` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `npd_project_motors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model` text NOT NULL,
	`motor_code` text DEFAULT '' NOT NULL,
	`rated_power` text DEFAULT '' NOT NULL,
	`voltage` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT '50Hz' NOT NULL,
	`poles` text DEFAULT '' NOT NULL,
	`speed` text DEFAULT '' NOT NULL,
	`frame_size` text DEFAULT '' NOT NULL,
	`mounting` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`inspection_requirement` text DEFAULT '' NOT NULL,
	`test_requirement` text DEFAULT '' NOT NULL,
	`planned_date` text NOT NULL,
	`actual_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_motors_project_model` ON `npd_project_motors` (`project_id`,`model`);--> statement-breakpoint
CREATE INDEX `idx_npd_motors_project` ON `npd_project_motors` (`project_id`);--> statement-breakpoint
CREATE TABLE `npd_project_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer NOT NULL,
	`owner_role` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`planned_date` text NOT NULL,
	`actual_date` text,
	`version` integer DEFAULT 1 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_sheets_project_code` ON `npd_project_sheets` (`project_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_npd_sheets_project_order` ON `npd_project_sheets` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_npd_sheets_status_date` ON `npd_project_sheets` (`status`,`planned_date`);--> statement-breakpoint
CREATE TABLE `npd_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`series_name` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`customer_id` text NOT NULL,
	`initiator_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`current_sheet_code` text DEFAULT 'initiation' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`planned_start` text NOT NULL,
	`planned_end` text NOT NULL,
	`actual_end` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `npd_customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`initiator_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npd_projects_code_unique` ON `npd_projects` (`code`);--> statement-breakpoint
CREATE INDEX `idx_npd_projects_status` ON `npd_projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_npd_projects_owner` ON `npd_projects` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_npd_projects_initiator` ON `npd_projects` (`initiator_id`,`status`);--> statement-breakpoint
CREATE TABLE `npd_test_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`motor_id` text NOT NULL,
	`report_no` text NOT NULL,
	`report_type` text NOT NULL,
	`title` text NOT NULL,
	`requirement_ref` text DEFAULT '' NOT NULL,
	`test_date` text NOT NULL,
	`result` text NOT NULL,
	`conclusion` text DEFAULT '' NOT NULL,
	`document_id` text,
	`submitted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `npd_project_motors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `npd_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_npd_tests_project_report_no` ON `npd_test_reports` (`project_id`,`report_no`);--> statement-breakpoint
CREATE INDEX `idx_npd_tests_motor` ON `npd_test_reports` (`motor_id`,`test_date`);--> statement-breakpoint
CREATE TABLE `npd_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`department` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`bootstrap_admin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npd_users_email_unique` ON `npd_users` (`email`);
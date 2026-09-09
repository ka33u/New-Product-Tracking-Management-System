-- Local legacy bootstrap has not run yet on a fresh installation. Existing
-- tables are untouched; the generated delta below owns the new column.
CREATE TABLE IF NOT EXISTS `npd_projects` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL UNIQUE,
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
ALTER TABLE `npd_projects` ADD `lifecycle_version` integer DEFAULT 1 NOT NULL;

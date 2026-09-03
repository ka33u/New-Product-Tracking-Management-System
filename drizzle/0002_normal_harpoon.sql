CREATE TABLE `npd_sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`customer_id` text NOT NULL,
	`project_id` text,
	`product_summary` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`order_date` text NOT NULL,
	`delivery_date` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `npd_customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `npd_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `npd_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npd_sales_orders_order_no_unique` ON `npd_sales_orders` (`order_no`);--> statement-breakpoint
CREATE INDEX `idx_npd_orders_project` ON `npd_sales_orders` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_npd_orders_customer` ON `npd_sales_orders` (`customer_id`,`delivery_date`);
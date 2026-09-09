-- Blank local installs have not yet run the legacy table bootstrap. Preserve
-- existing rows and provide only the legacy shape before adding constant columns.
CREATE TABLE IF NOT EXISTS `npd_project_members` (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
  user_id TEXT NOT NULL REFERENCES npd_users(id), responsibility TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `npd_sales_orders` (
  id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES npd_customers(id),
  project_id TEXT REFERENCES npd_projects(id), product_summary TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1, amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY', order_date TEXT NOT NULL,
  delivery_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
  created_by TEXT NOT NULL REFERENCES npd_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE `npd_project_members` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `npd_sales_orders` ADD `version` integer DEFAULT 1 NOT NULL;

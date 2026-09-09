-- Fresh local installations have not run the legacy request bootstrap yet.
-- This is the unchanged pre-0010 motor table; existing rows/tables are untouched.
-- The generated ALTER statements below own the new production receipt fields.
CREATE TABLE IF NOT EXISTS `npd_project_motors` (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
  model TEXT NOT NULL, motor_code TEXT NOT NULL DEFAULT '', rated_power TEXT NOT NULL DEFAULT '',
  voltage TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL DEFAULT '50Hz',
  poles TEXT NOT NULL DEFAULT '', speed TEXT NOT NULL DEFAULT '', frame_size TEXT NOT NULL DEFAULT '',
  mounting TEXT NOT NULL DEFAULT '', terminal_mode TEXT NOT NULL DEFAULT '',
  protection_grade TEXT NOT NULL DEFAULT '', insulation_class TEXT NOT NULL DEFAULT '',
  cooling_method TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1,
  design_revision INTEGER NOT NULL DEFAULT 1,
  inspection_requirement TEXT NOT NULL DEFAULT '', test_requirement TEXT NOT NULL DEFAULT '',
  planned_date TEXT NOT NULL, actual_date TEXT, status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `confirmed_by` text REFERENCES npd_users(id);--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `confirmed_at` text;--> statement-breakpoint
ALTER TABLE `npd_project_motors` ADD `production_note` text DEFAULT '' NOT NULL;

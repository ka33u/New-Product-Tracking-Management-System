-- Local installations predating generated migrations bootstrap this legacy
-- table at request time. Ensure it exists before this migration on a blank DB;
-- on an existing local or hosted DB this statement preserves all existing rows.
CREATE TABLE IF NOT EXISTS `npd_users` (
  id TEXT PRIMARY KEY, auth_user_id TEXT UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  department TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  bootstrap_admin INTEGER NOT NULL DEFAULT 0,
  password_salt TEXT, password_hash TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE `npd_users` ADD `version` integer DEFAULT 1 NOT NULL;

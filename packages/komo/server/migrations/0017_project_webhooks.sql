ALTER TABLE project_settings ADD COLUMN webhook_url TEXT;
ALTER TABLE project_settings ADD COLUMN webhook_secret TEXT;
ALTER TABLE project_settings ADD COLUMN webhook_events TEXT;
ALTER TABLE project_settings ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0;

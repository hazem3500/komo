ALTER TABLE project_settings ADD COLUMN webhook_url text;
ALTER TABLE project_settings ADD COLUMN webhook_secret text;
ALTER TABLE project_settings ADD COLUMN webhook_events text;
ALTER TABLE project_settings ADD COLUMN webhook_enabled integer NOT NULL DEFAULT 0;

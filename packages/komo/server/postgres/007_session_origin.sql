-- How each session was signed in ('proxy', 'google', 'github' or 'guest') and
-- when. Both stay NULL on sessions from before this migration.
ALTER TABLE sessions ADD COLUMN via text;
ALTER TABLE sessions ADD COLUMN created_at bigint;

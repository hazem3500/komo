-- Opt-in element snapshots: at most one image and one HTML capture per thread.
CREATE TABLE snapshots (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','html')),
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(thread_id, kind)
);
-- Delete snapshots while the thread's project is still known for quota accounting.
CREATE TRIGGER thread_delete_snapshots BEFORE DELETE ON threads BEGIN
  DELETE FROM snapshots WHERE thread_id=OLD.id;
END;
CREATE TRIGGER snapshot_quota_insert AFTER INSERT ON snapshots BEGIN
  UPDATE project_quotas SET bytes=bytes+NEW.size+256
    WHERE project=(SELECT project FROM threads WHERE id=NEW.thread_id);
  SELECT RAISE(ABORT, 'komo_quota_exceeded') WHERE EXISTS(SELECT 1 FROM project_quotas
    WHERE project=(SELECT project FROM threads WHERE id=NEW.thread_id) AND bytes>max_bytes);
END;
CREATE TRIGGER snapshot_quota_update AFTER UPDATE OF size ON snapshots BEGIN
  UPDATE project_quotas SET bytes=MAX(0,bytes+NEW.size-OLD.size)
    WHERE project=(SELECT project FROM threads WHERE id=NEW.thread_id);
  SELECT RAISE(ABORT, 'komo_quota_exceeded') WHERE EXISTS(SELECT 1 FROM project_quotas
    WHERE project=(SELECT project FROM threads WHERE id=NEW.thread_id) AND bytes>max_bytes);
END;
CREATE TRIGGER snapshot_quota_delete AFTER DELETE ON snapshots BEGIN
  UPDATE project_quotas SET bytes=MAX(0,bytes-OLD.size-256)
    WHERE project=(SELECT project FROM threads WHERE id=OLD.thread_id);
END;

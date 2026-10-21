-- Mirrors SQLite migration 0019: opt-in element snapshots, one image and one HTML per thread.
CREATE TABLE snapshots (thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('image','html')), mime text NOT NULL, bytes bytea NOT NULL, size integer NOT NULL, created_at bigint NOT NULL, PRIMARY KEY(thread_id,kind));
CREATE FUNCTION komo_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text;
BEGIN
  SELECT project INTO p FROM threads WHERE id=COALESCE(NEW.thread_id,OLD.thread_id);
  IF TG_OP='INSERT' THEN
    PERFORM komo_quota(p,0,NEW.size+256);
  ELSIF TG_OP='UPDATE' THEN
    PERFORM komo_quota(p,0,NEW.size-OLD.size);
  ELSE
    PERFORM komo_quota(p,0,-(OLD.size+256));
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER snapshot_change AFTER INSERT OR UPDATE OR DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION komo_snapshot_change();
-- Delete snapshots while the thread's project is still known for quota accounting.
CREATE FUNCTION komo_thread_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM snapshots WHERE thread_id=OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER thread_snapshots BEFORE DELETE ON threads FOR EACH ROW EXECUTE FUNCTION komo_thread_snapshots();

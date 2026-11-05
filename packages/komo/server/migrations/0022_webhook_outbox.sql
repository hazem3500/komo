CREATE TABLE webhook_outbox (
 id TEXT PRIMARY KEY,
 project TEXT NOT NULL,
 body TEXT NOT NULL,
 url TEXT NOT NULL,
 secret TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt BIGINT NOT NULL,
 claim_until BIGINT NOT NULL DEFAULT 0,
 claim_token TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX webhook_outbox_due ON webhook_outbox(state,next_attempt,claim_until);
ALTER TABLE threads ADD COLUMN snapshot_status TEXT;

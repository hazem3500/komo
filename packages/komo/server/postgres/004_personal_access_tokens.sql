CREATE TABLE personal_access_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  last4 text NOT NULL,
  salt text NOT NULL,
  token_hash text NOT NULL,
  scopes text NOT NULL,
  projects text,
  created_at bigint NOT NULL,
  expires_at bigint,
  last_used_at bigint,
  revoked_at bigint
);
CREATE INDEX personal_access_tokens_user ON personal_access_tokens(user_id, created_at);
CREATE TABLE audit_log (
  id text PRIMARY KEY,
  at bigint NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  detail text NOT NULL
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_actor ON audit_log(actor, at);

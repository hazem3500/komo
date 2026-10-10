CREATE TABLE comment_tags (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(comment_id, tag)
);
CREATE INDEX comment_tags_lookup ON comment_tags(tag, comment_id);

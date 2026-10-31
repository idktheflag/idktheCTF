CREATE TABLE attachment_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  attachment_id TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  upload_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE attachment_upload_parts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES attachment_uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE UNIQUE INDEX attachment_upload_parts_session_part_idx ON attachment_upload_parts(session_id, part_number);
CREATE INDEX attachment_upload_parts_session_idx ON attachment_upload_parts(session_id);
CREATE INDEX attachment_uploads_expires_at_idx ON attachment_uploads(expires_at);

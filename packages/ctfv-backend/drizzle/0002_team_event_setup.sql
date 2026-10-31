CREATE TABLE event_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER,
  ends_at INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  registration_mode TEXT NOT NULL DEFAULT 'public',
  allowed_email_domains TEXT NOT NULL DEFAULT '[]',
  paused INTEGER NOT NULL DEFAULT 0,
  scoreboard_frozen_at INTEGER,
  setup_complete INTEGER NOT NULL DEFAULT 1,
  max_team_size INTEGER NOT NULL DEFAULT 4
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  join_code TEXT NOT NULL UNIQUE,
  captain_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

ALTER TABLE submissions ADD COLUMN teamId TEXT REFERENCES teams(id) ON DELETE SET NULL;

-- Preserve existing competitors and their scores by assigning each a solo team.
INSERT INTO teams(id, name, join_code, captain_id)
SELECT 'legacy-' || id, 'solo-' || substr(id, 1, 12), lower(hex(randomblob(16))), id
FROM user WHERE isAdmin = 0;

INSERT INTO team_members(id, team_id, user_id)
SELECT 'legacy-member-' || id, 'legacy-' || id, id
FROM user WHERE isAdmin = 0;

UPDATE submissions
SET teamId = 'legacy-' || userId
WHERE userId IN (SELECT id FROM user WHERE isAdmin = 0);

-- Existing admin installs remain initialized and keep their data.
INSERT INTO event_settings(id, name, setup_complete)
SELECT 1, 'CTFv', 1
WHERE EXISTS (SELECT 1 FROM user WHERE isAdmin = 1);

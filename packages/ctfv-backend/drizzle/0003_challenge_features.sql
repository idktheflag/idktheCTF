ALTER TABLE challenges ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE challenges ADD COLUMN max_attempts INTEGER;

CREATE TABLE challenge_flags (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'static' CHECK (type IN ('static', 'regex'))
);
INSERT INTO challenge_flags (id, challenge_id, value, type)
SELECT lower(hex(randomblob(16))), id, flag, 'static' FROM challenges WHERE flag <> '';

CREATE TABLE challenge_hints (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE challenge_tags (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);
CREATE TABLE hint_unlocks (
  id TEXT PRIMARY KEY NOT NULL,
  hint_id TEXT NOT NULL REFERENCES challenge_hints(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  unlocked_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (hint_id, team_id)
);

CREATE TABLE team_solves (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  solved_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (team_id, challenge_id),
  UNIQUE (submission_id)
);
INSERT INTO team_solves (id, team_id, challenge_id, submission_id, solved_at)
SELECT lower(hex(randomblob(16))), s.teamId, s.challengeId, s.id, s.timestamp
FROM submissions s
WHERE s.isCorrect = 1 AND s.teamId IS NOT NULL
  AND s.id = (
    SELECT first.id FROM submissions first
    WHERE first.isCorrect = 1 AND first.teamId = s.teamId AND first.challengeId = s.challengeId
    ORDER BY first.timestamp, first.id LIMIT 1
  );

CREATE INDEX submissions_timestamp_idx ON submissions(timestamp);
CREATE INDEX submissions_team_challenge_timestamp_idx ON submissions(teamId, challengeId, timestamp);
CREATE INDEX submissions_user_timestamp_idx ON submissions(userId, timestamp);
CREATE INDEX submissions_challenge_timestamp_idx ON submissions(challengeId, timestamp);

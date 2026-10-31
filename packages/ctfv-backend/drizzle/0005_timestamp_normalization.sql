UPDATE submissions SET timestamp = CAST(strftime('%s', timestamp) AS INTEGER) * 1000
WHERE typeof(timestamp) = 'text' AND strftime('%s', timestamp) IS NOT NULL;
UPDATE team_solves SET solved_at = CAST(strftime('%s', solved_at) AS INTEGER) * 1000
WHERE typeof(solved_at) = 'text' AND strftime('%s', solved_at) IS NOT NULL;

ALTER TABLE user ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
-- Old verification links are invalidated by the new purpose/version contract.
UPDATE user SET lastVerificationEmailSent = NULL WHERE emailVerified = 0;

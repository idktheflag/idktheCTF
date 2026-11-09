import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("name").notNull().unique(),
  email: text("email").unique().notNull(),
  password: text("password").notNull(),
  authVersion: integer("auth_version").notNull().default(0),
  rollNo: text("rollNo"),
  instituteName: text("instituteName"),
  image: text("image"),
  website: text("website"),
  affiliation: text("affiliation"),
  country: text("country"),
  isAdmin: integer("isAdmin", { mode: "boolean" }).notNull().default(false),
  isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  lastVerificationEmailSent: integer("lastVerificationEmailSent", {
    mode: "timestamp_ms",
  }),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  userIndex: index("password_reset_tokens_user_idx").on(table.userId),
  expiresIndex: index("password_reset_tokens_expires_idx").on(table.expiresAt),
}));

export const registrationInvitations = sqliteTable("registration_invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  emailIndex: index("registration_invitations_email_idx").on(table.email),
  expiryIndex: index("registration_invitations_expiry_idx").on(table.expiresAt),
}));

export const challenges = sqliteTable("challenges", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  points: integer("points").notNull(),
  category: text("category").notNull(),
  author: text("author").notNull(),
  flag: text("flag").notNull(),
  flagVersion: integer("flag_version").notNull().default(0),
  date: text("date"),
  isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
  maxAttempts: integer("max_attempts"),
});

export const submissions = sqliteTable("submissions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  challengeId: text("challengeId")
    .notNull()
    .references(() => challenges.id, { onDelete: "cascade" }),
  input: text("input").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(current_timestamp)`),
  isCorrect: integer("isCorrect", { mode: "boolean" }).notNull(),
  teamId: text("teamId"),
}, (table) => ({
  timestampIndex: index("submissions_timestamp_idx").on(table.timestamp),
  teamTimestampIndex: index("submissions_team_timestamp_idx").on(table.teamId, table.timestamp),
  teamChallengeTimestampIndex: index("submissions_team_challenge_timestamp_idx").on(table.teamId, table.challengeId, table.timestamp),
  userTimestampIndex: index("submissions_user_timestamp_idx").on(table.userId, table.timestamp),
  challengeTimestampIndex: index("submissions_challenge_timestamp_idx").on(table.challengeId, table.timestamp),
}));

export const eventSettings = sqliteTable("event_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }),
  timezone: text("timezone").notNull().default("UTC"),
  registrationMode: text("registration_mode").notNull().default("public"),
  allowedEmailDomains: text("allowed_email_domains").notNull().default("[]"),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  scoreboardFrozenAt: integer("scoreboard_frozen_at", { mode: "timestamp_ms" }),
  setupComplete: integer("setup_complete", { mode: "boolean" }).notNull().default(true),
  maxTeamSize: integer("max_team_size").notNull().default(4),
  scoreboardPublic: integer("scoreboard_public", { mode: "boolean" }).notNull().default(true),
  viewChallengesAfterEnd: integer("view_challenges_after_end", { mode: "boolean" }).notNull().default(true),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  joinCode: text("join_code").notNull().unique(),
  captainId: text("captain_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
});

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const challengeFlags = sqliteTable("challenge_flags", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  type: text("type").notNull().default("static"),
});

export const challengeHints = sqliteTable("challenge_hints", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  cost: integer("cost").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const challengeTags = sqliteTable("challenge_tags", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});

export const hintUnlocks = sqliteTable("hint_unlocks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  hintId: text("hint_id").notNull().references(() => challengeHints.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  unlockedAt: integer("unlocked_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const teamSolves = sqliteTable("team_solves", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  solvedAt: integer("solved_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  body: text("body").notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const contentPages = sqliteTable("content_pages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text("actor_id").notNull(),
  actorUsername: text("actor_username").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const attachmentUploads = sqliteTable("attachment_uploads", {
  id: text("id").primaryKey(),
  attachmentId: text("attachment_id").notNull().unique(),
  challengeId: text("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  uploadId: text("upload_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  partSize: integer("part_size").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
});

export const attachmentUploadParts = sqliteTable("attachment_upload_parts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id").notNull().references(() => attachmentUploads.id, { onDelete: "cascade" }),
  partNumber: integer("part_number").notNull(),
  etag: text("etag").notNull(),
  size: integer("size").notNull(),
}, (table) => ({
  sessionPartUnique: uniqueIndex("attachment_upload_parts_session_part_idx").on(table.sessionId, table.partNumber),
  sessionIndex: index("attachment_upload_parts_session_idx").on(table.sessionId),
}));

export const r2CleanupJobs = sqliteTable("r2_cleanup_jobs", {
  objectKey: text("object_key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(current_timestamp)`),
}, (table) => ({
  nextAttemptIndex: index("r2_cleanup_jobs_next_attempt_idx").on(table.nextAttemptAt),
}));

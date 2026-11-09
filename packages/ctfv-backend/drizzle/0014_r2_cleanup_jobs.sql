CREATE TABLE `r2_cleanup_jobs` (
  `object_key` text PRIMARY KEY NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `next_attempt_at` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (current_timestamp) NOT NULL
);
CREATE INDEX `r2_cleanup_jobs_next_attempt_idx` ON `r2_cleanup_jobs` (`next_attempt_at`);

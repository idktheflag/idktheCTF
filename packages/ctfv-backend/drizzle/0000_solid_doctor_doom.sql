CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`url` text NOT NULL,
	`points` integer NOT NULL,
	`category` text NOT NULL,
	`author` text NOT NULL,
	`flag` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`challengeId` text NOT NULL,
	`input` text NOT NULL,
	`timestamp` integer DEFAULT (current_timestamp) NOT NULL,
	`isCorrect` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`rollNo` text,
	`instituteName` text,
	`image` text,
	`website` text,
	`affiliation` text,
	`country` text,
	`isAdmin` integer DEFAULT false NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`lastVerificationEmailSent` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_name_unique` ON `user` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
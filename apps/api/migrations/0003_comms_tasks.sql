-- Phase 4: client communication log + tasks rebuild (status in_progress, created_by, communication link).
-- Hand-fixed before first apply: drizzle-kit copied the two NEW task columns from the old table;
-- they don't exist there, so they are copied as NULL. PRAGMA foreign_keys lines are no-ops inside
-- the migration transaction (see migrator.ts); nothing references tasks, so the DROP is safe.
CREATE TABLE `client_communications` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`contact_id` text,
	`author_user_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`,`client_id`) REFERENCES `client_contacts`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_communications_occurred_at_utc_iso" CHECK(occurred_at IS NULL OR occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_communications_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_communications_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_communications_type_valid" CHECK(type IN ('call', 'whatsapp', 'meeting', 'email', 'note')),
	CONSTRAINT "client_communications_summary_len" CHECK(length(summary) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_communications_id_client_unique` ON `client_communications` (`id`,`client_id`);--> statement-breakpoint
CREATE INDEX `client_communications_client_occurred_idx` ON `client_communications` (`client_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `client_communications_contact_idx` ON `client_communications` (`contact_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`lead_id` text,
	`assigned_user_id` text NOT NULL,
	`created_by_user_id` text,
	`communication_id` text,
	`title` text NOT NULL,
	`description` text,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`,`client_id`) REFERENCES `leads`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`communication_id`,`client_id`) REFERENCES `client_communications`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_due_at_utc_iso" CHECK(due_at IS NULL OR due_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_completed_at_utc_iso" CHECK(completed_at IS NULL OR completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_status_valid" CHECK(status IN ('open', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "tasks_completed_consistent" CHECK((status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "client_id", "lead_id", "assigned_user_id", "created_by_user_id", "communication_id", "title", "description", "due_at", "status", "completed_at", "created_at", "updated_at") SELECT "id", "client_id", "lead_id", "assigned_user_id", NULL, NULL, "title", "description", "due_at", "status", "completed_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_communication_idx` ON `tasks` (`communication_id`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_status_due_idx` ON `tasks` (`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_client_status_due_idx` ON `tasks` (`client_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_lead_idx` ON `tasks` (`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_contacts_id_client_unique` ON `client_contacts` (`id`,`client_id`);
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`client_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_events_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "audit_events_json_valid" CHECK((before_json IS NULL OR json_valid(before_json)) AND (after_json IS NULL OR json_valid(after_json)))
);
--> statement-breakpoint
CREATE INDEX `audit_events_client_created_idx` ON `audit_events` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaigns_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "campaigns_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "campaigns_channel_valid" CHECK(channel IN ('meta', 'google', 'tiktok', 'organic', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_external_unique` ON `campaigns` (`client_id`,`channel`,`external_id`) WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_id_client_unique` ON `campaigns` (`id`,`client_id`);--> statement-breakpoint
CREATE TABLE `client_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`phone` text,
	`email` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_contacts_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_contacts_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
CREATE INDEX `client_contacts_client_idx` ON `client_contacts` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_contacts_one_primary` ON `client_contacts` (`client_id`) WHERE is_primary = 1;--> statement-breakpoint
CREATE TABLE `client_members` (
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_role` text DEFAULT 'collaborator' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`client_id`, `user_id`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_members_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_members_role_valid" CHECK(membership_role IN ('owner', 'collaborator'))
);
--> statement-breakpoint
CREATE INDEX `client_members_user_idx` ON `client_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`industry` text,
	`phone` text,
	`email` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	CONSTRAINT "clients_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "clients_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "clients_archived_at_utc_iso" CHECK(archived_at IS NULL OR archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "clients_status_valid" CHECK(status IN ('active', 'paused', 'archived')),
	CONSTRAINT "clients_archived_consistent" CHECK((status = 'archived') = (archived_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `clients_status_name_idx` ON `clients` (`status`,`name`);--> statement-breakpoint
CREATE TABLE `lead_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`type` text NOT NULL,
	`body` text,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lead_activities_occurred_at_utc_iso" CHECK(occurred_at IS NULL OR occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "lead_activities_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "lead_activities_type_valid" CHECK(type IN ('note', 'call', 'whatsapp', 'email', 'meeting', 'stage_change')),
	CONSTRAINT "lead_activities_metadata_json" CHECK(metadata_json IS NULL OR json_valid(metadata_json))
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead_occurred_idx` ON `lead_activities` (`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `lead_activities_actor_idx` ON `lead_activities` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `lead_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_created` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lead_import_batches_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "lead_import_batches_counts_valid" CHECK(rows_total >= 0 AND rows_created >= 0 AND rows_skipped >= 0 AND rows_created + rows_skipped <= rows_total)
);
--> statement-breakpoint
CREATE INDEX `lead_import_batches_client_idx` ON `lead_import_batches` (`client_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lead_import_batches_id_client_unique` ON `lead_import_batches` (`id`,`client_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`campaign_id` text,
	`import_batch_id` text,
	`assigned_user_id` text,
	`full_name` text NOT NULL,
	`phone_raw` text,
	`phone_normalized` text,
	`email` text,
	`source` text NOT NULL,
	`source_external_id` text,
	`consent_status` text DEFAULT 'unknown' NOT NULL,
	`consent_at` text,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_id`,`client_id`) REFERENCES `pipelines`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`,`pipeline_id`) REFERENCES `pipeline_stages`(`id`,`pipeline_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`client_id`) REFERENCES `campaigns`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`,`client_id`) REFERENCES `lead_import_batches`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leads_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "leads_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "leads_consent_at_utc_iso" CHECK(consent_at IS NULL OR consent_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "leads_archived_at_utc_iso" CHECK(archived_at IS NULL OR archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "leads_source_valid" CHECK(source IN ('manual', 'web_form', 'csv_import', 'meta', 'google', 'tiktok', 'whatsapp', 'phone', 'referral', 'other')),
	CONSTRAINT "leads_consent_valid" CHECK(consent_status IN ('unknown', 'granted', 'denied')),
	CONSTRAINT "leads_email_normalized" CHECK(email IS NULL OR email = lower(trim(email)))
);
--> statement-breakpoint
CREATE INDEX `leads_client_created_idx` ON `leads` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `leads_client_stage_idx` ON `leads` (`client_id`,`stage_id`);--> statement-breakpoint
CREATE INDEX `leads_client_assignee_idx` ON `leads` (`client_id`,`assigned_user_id`);--> statement-breakpoint
CREATE INDEX `leads_client_phone_idx` ON `leads` (`client_id`,`phone_normalized`);--> statement-breakpoint
CREATE INDEX `leads_client_email_idx` ON `leads` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `leads_assignee_idx` ON `leads` (`assigned_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_source_external_unique` ON `leads` (`client_id`,`source`,`source_external_id`) WHERE source_external_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `leads_id_client_unique` ON `leads` (`id`,`client_id`);--> statement-breakpoint
CREATE TABLE `pipeline_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`stage_type` text DEFAULT 'open' NOT NULL,
	`color` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pipeline_stages_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "pipeline_stages_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "pipeline_stages_type_valid" CHECK(stage_type IN ('open', 'won', 'lost')),
	CONSTRAINT "pipeline_stages_position_nonneg" CHECK(position >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_stages_id_pipeline_unique` ON `pipeline_stages` (`id`,`pipeline_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_stages_position_unique` ON `pipeline_stages` (`pipeline_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_stages_name_unique` ON `pipeline_stages` (`pipeline_id`,`name`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pipelines_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "pipelines_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipelines_one_default` ON `pipelines` (`client_id`) WHERE is_default = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `pipelines_id_client_unique` ON `pipelines` (`id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pipelines_client_name_unique` ON `pipelines` (`client_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sessions_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "sessions_expires_at_utc_iso" CHECK(expires_at IS NULL OR expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "sessions_revoked_at_utc_iso" CHECK(revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "sessions_last_seen_at_utc_iso" CHECK(last_seen_at IS NULL OR last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`lead_id` text,
	`assigned_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`,`client_id`) REFERENCES `leads`(`id`,`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_due_at_utc_iso" CHECK(due_at IS NULL OR due_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_completed_at_utc_iso" CHECK(completed_at IS NULL OR completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "tasks_status_valid" CHECK(status IN ('open', 'done', 'cancelled')),
	CONSTRAINT "tasks_completed_consistent" CHECK((status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX `tasks_assignee_status_due_idx` ON `tasks` (`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_client_status_due_idx` ON `tasks` (`client_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_lead_idx` ON `tasks` (`lead_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "users_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "users_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "users_email_normalized" CHECK(email = lower(trim(email)) AND email <> ''),
	CONSTRAINT "users_role_valid" CHECK(role IN ('admin', 'manager', 'employee'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
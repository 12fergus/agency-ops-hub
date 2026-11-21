CREATE TABLE `client_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "client_statuses_created_at_utc_iso" CHECK(created_at IS NULL OR created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_statuses_updated_at_utc_iso" CHECK(updated_at IS NULL OR updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "client_statuses_color_valid" CHECK(color IN ('green', 'gray', 'amber', 'blue', 'red', 'purple', 'teal', 'pink'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_statuses_name_unique` ON `client_statuses` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_statuses_one_default` ON `client_statuses` (`is_default`) WHERE is_default = 1;--> statement-breakpoint
ALTER TABLE `clients` ADD `status_id` text REFERENCES client_statuses(id);--> statement-breakpoint
ALTER TABLE `clients` ADD `photo_type` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `photo_updated_at` text;--> statement-breakpoint
CREATE INDEX `clients_status_id_idx` ON `clients` (`status_id`);--> statement-breakpoint
-- Starting statuses (admins can rename, recolor, reorder and add more). Fixed ids.
INSERT INTO `client_statuses` (`id`, `name`, `color`, `position`, `is_default`) VALUES ('01a1fe07-4254-7d8d-bf8f-9e02ae6d5173', 'פעיל', 'green', 0, 1), ('01a1fe07-4254-7ce9-b641-d689b0006bdd', 'לא פעיל', 'gray', 1, 0), ('01a1fe07-4254-7316-8e2a-482896813e79', 'מושהה', 'amber', 2, 0);--> statement-breakpoint
-- Former lifecycle "paused" becomes the custom status מושהה; everyone else starts as פעיל.
UPDATE `clients` SET `status_id` = '01a1fe07-4254-7316-8e2a-482896813e79' WHERE `status` = 'paused';--> statement-breakpoint
UPDATE `clients` SET `status_id` = '01a1fe07-4254-7d8d-bf8f-9e02ae6d5173' WHERE `status_id` IS NULL;--> statement-breakpoint
-- From now on `status` only marks archived vs not archived.
UPDATE `clients` SET `status` = 'active' WHERE `status` = 'paused';

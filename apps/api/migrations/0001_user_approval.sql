ALTER TABLE `users` ADD `approved_at` text;--> statement-breakpoint
-- Everyone who exists before self-signup was created by an admin (or the bootstrap CLI): approved.
UPDATE `users` SET `approved_at` = `created_at` WHERE `approved_at` IS NULL;

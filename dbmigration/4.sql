ALTER TABLE orders MODIFY `created` timestamp NOT NULL DEFAULT current_timestamp();
ALTER TABLE orders ADD IF NOT EXISTS `updated` timestamp NULL DEFAULT NULL;

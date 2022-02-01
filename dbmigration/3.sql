ALTER TABLE orders_orders_fields ADD FULLTEXT INDEX IF NOT EXISTS idx_ft (fieldValue);
ALTER TABLE orders_rows_fields ADD FULLTEXT INDEX IF NOT EXISTS idx_ft (rowStrValue);

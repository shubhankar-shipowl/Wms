-- Add zone column to products table
-- Zone options: A, B, C, D, E, F, G, H, I, J

-- Check if column exists before adding (MySQL doesn't support IF NOT EXISTS for ALTER TABLE)
SET @dbname = DATABASE();
SET @tablename = 'products';
SET @columnname = 'zone';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(10) DEFAULT NULL')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add index for zone (will fail silently if index already exists)
CREATE INDEX idx_zone ON products(zone);


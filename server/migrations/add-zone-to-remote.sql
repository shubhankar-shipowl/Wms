-- Add zone column to products table on remote database
-- Run this on the remote database: 31.97.61.5

USE wms_db;

-- Add zone column if it doesn't exist
ALTER TABLE products 
ADD COLUMN zone VARCHAR(10) DEFAULT NULL;

-- Add index for zone
CREATE INDEX idx_zone ON products(zone);


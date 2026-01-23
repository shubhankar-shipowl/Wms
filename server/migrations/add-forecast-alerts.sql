-- Migration: Add forecast-based alert support
-- This migration adds columns to support forecast-based low stock alerts
-- Note: The forecast logic is currently calculated on-the-fly in the API,
-- but these columns can be used for caching forecast data in the future

-- Add forecast columns to alerts table (if it exists)
-- Note: This is optional since we're calculating forecast on-the-fly
-- Uncomment if you want to store forecast data in the database

/*
ALTER TABLE alerts 
ADD COLUMN IF NOT EXISTS avg_daily_consumption DECIMAL(10, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS days_until_stockout DECIMAL(10, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS alert_type VARCHAR(20) DEFAULT 'threshold' 
  CHECK (alert_type IN ('threshold', 'forecast', 'both'));
*/

-- Note: The forecast-based alert logic is implemented in:
-- server/routes/alerts.js
-- 
-- The logic calculates:
-- 1. Average daily stock out based on last 90 days of transactions
-- 2. Days until stockout = current_stock / avg_daily_consumption
-- 3. Alerts are shown if days_until_stockout <= 15 days
--
-- This works alongside the existing threshold-based alerts:
-- - Threshold alerts: stock <= low_stock_threshold
-- - Forecast alerts: will run out in 15 days or less
-- - Both: product meets both conditions

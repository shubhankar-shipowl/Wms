-- Create database schema for Warehouse Management System

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    initial_stock INTEGER DEFAULT 0,
    current_stock INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 10,
    hsn_code VARCHAR(50),
    gst_rate DECIMAL(5, 2) DEFAULT 0,
    rack VARCHAR(50),
    origin VARCHAR(255),
    description TEXT,
    images TEXT[], -- Array to store image paths
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Barcodes table
CREATE TABLE IF NOT EXISTS barcodes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    barcode VARCHAR(255) UNIQUE NOT NULL,
    units_assigned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stock transactions table
CREATE TABLE IF NOT EXISTS stock_transactions (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    barcode_id INTEGER REFERENCES barcodes(id) ON DELETE CASCADE,
    transaction_type VARCHAR(10) CHECK (transaction_type IN ('IN', 'OUT')),
    quantity INTEGER NOT NULL,
    reference_number VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Current stock levels (materialized view for performance)
CREATE TABLE IF NOT EXISTS current_stock (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    barcode_id INTEGER REFERENCES barcodes(id) ON DELETE CASCADE,
    current_quantity INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, barcode_id)
);

-- Barcode generation suggestions table
CREATE TABLE IF NOT EXISTS barcode_suggestions (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    suggested_quantity INTEGER NOT NULL,
    reasoning TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'modified')),
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(255)
);

-- Low stock alerts table
CREATE TABLE IF NOT EXISTS low_stock_alerts (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    current_stock INTEGER,
    threshold INTEGER,
    alert_status VARCHAR(20) DEFAULT 'active' CHECK (alert_status IN ('active', 'resolved', 'dismissed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    -- Forecast-based alert fields
    avg_daily_consumption DECIMAL(10, 2),
    days_until_stockout DECIMAL(10, 2),
    alert_type VARCHAR(20) DEFAULT 'threshold' CHECK (alert_type IN ('threshold', 'forecast', 'both'))
);

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_barcodes_product_id ON barcodes(product_id);
CREATE INDEX IF NOT EXISTS idx_barcodes_barcode ON barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_product_id ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_barcode_id ON stock_transactions(barcode_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_type ON stock_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_created_at ON stock_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_current_stock_product_id ON current_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_low_stock_alerts_status ON low_stock_alerts(alert_status);

-- Function to update current stock after transactions
CREATE OR REPLACE FUNCTION update_current_stock()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update current stock
    INSERT INTO current_stock (product_id, barcode_id, current_quantity, last_updated)
    VALUES (NEW.product_id, NEW.barcode_id, 
        CASE 
            WHEN NEW.transaction_type = 'IN' THEN NEW.quantity
            ELSE -NEW.quantity
        END,
        CURRENT_TIMESTAMP)
    ON CONFLICT (product_id, barcode_id)
    DO UPDATE SET 
        current_quantity = current_stock.current_quantity + 
            CASE 
                WHEN NEW.transaction_type = 'IN' THEN NEW.quantity
                ELSE -NEW.quantity
            END,
        last_updated = CURRENT_TIMESTAMP;
    
    -- Update product's current_stock field
    UPDATE products 
    SET current_stock = (
        SELECT COALESCE(SUM(cs.current_quantity), 0)
        FROM current_stock cs
        JOIN barcodes b ON cs.barcode_id = b.id
        WHERE b.product_id = NEW.product_id
    )
    WHERE id = NEW.product_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update stock levels
DROP TRIGGER IF EXISTS trigger_update_current_stock ON stock_transactions;
CREATE TRIGGER trigger_update_current_stock
    AFTER INSERT ON stock_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_current_stock();

-- Function to calculate average daily stock out for a product
CREATE OR REPLACE FUNCTION calculate_avg_daily_consumption(p_product_id INTEGER)
RETURNS DECIMAL(10, 2) AS $$
DECLARE
    avg_daily_out DECIMAL(10, 2);
    total_out INTEGER;
    days_with_transactions INTEGER;
BEGIN
    -- Calculate total stock out in the last 90 days (or all time if less than 90 days)
    SELECT COALESCE(SUM(quantity), 0) INTO total_out
    FROM stock_transactions
    WHERE product_id = p_product_id
      AND transaction_type = 'OUT'
      AND created_at >= CURRENT_DATE - INTERVAL '90 days';
    
    -- Calculate number of days with transactions (minimum 1 to avoid division by zero)
    SELECT GREATEST(
        COUNT(DISTINCT DATE(created_at)),
        1
    ) INTO days_with_transactions
    FROM stock_transactions
    WHERE product_id = p_product_id
      AND transaction_type = 'OUT'
      AND created_at >= CURRENT_DATE - INTERVAL '90 days';
    
    -- Calculate average daily consumption
    avg_daily_out := total_out::DECIMAL / days_with_transactions::DECIMAL;
    
    RETURN COALESCE(avg_daily_out, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to check for low stock and create alerts (with forecast logic)
CREATE OR REPLACE FUNCTION check_low_stock()
RETURNS TRIGGER AS $$
DECLARE
    product_threshold INTEGER;
    total_stock INTEGER;
    avg_daily_cons DECIMAL(10, 2);
    days_until_out DECIMAL(10, 2);
    should_alert BOOLEAN := FALSE;
    alert_type_val VARCHAR(20) := 'threshold';
BEGIN
    -- Get product threshold
    SELECT low_stock_threshold INTO product_threshold
    FROM products WHERE id = NEW.product_id;
    
    -- Calculate total stock for the product
    SELECT COALESCE(SUM(current_quantity), 0) INTO total_stock
    FROM current_stock WHERE product_id = NEW.product_id;
    
    -- Calculate average daily consumption
    avg_daily_cons := calculate_avg_daily_consumption(NEW.product_id);
    
    -- Calculate days until stockout (only if there's consumption data)
    IF avg_daily_cons > 0 AND total_stock > 0 THEN
        days_until_out := total_stock::DECIMAL / avg_daily_cons;
    ELSE
        days_until_out := NULL;
    END IF;
    
    -- Check if alert should be created based on forecast (will run out in 15 days or less)
    -- Also alert if stock is 0 (critical case)
    IF total_stock = 0 THEN
        should_alert := TRUE;
        alert_type_val := 'forecast';
    ELSIF days_until_out IS NOT NULL AND days_until_out <= 15 AND total_stock > 0 THEN
        should_alert := TRUE;
        alert_type_val := 'forecast';
    END IF;
    
    -- Create alert if conditions are met and no active alert exists
    IF should_alert THEN
        INSERT INTO low_stock_alerts (
            product_id, 
            current_stock, 
            threshold,
            avg_daily_consumption,
            days_until_stockout,
            alert_type
        )
        SELECT 
            NEW.product_id, 
            total_stock, 
            product_threshold,
            avg_daily_cons,
            days_until_out,
            alert_type_val
        WHERE NOT EXISTS (
            SELECT 1 FROM low_stock_alerts 
            WHERE product_id = NEW.product_id AND alert_status = 'active'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to check low stock after stock updates
DROP TRIGGER IF EXISTS trigger_check_low_stock ON current_stock;
CREATE TRIGGER trigger_check_low_stock
    AFTER INSERT OR UPDATE ON current_stock
    FOR EACH ROW
    EXECUTE FUNCTION check_low_stock();
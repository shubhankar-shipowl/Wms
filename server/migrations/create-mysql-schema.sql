-- MySQL Database Schema for WMS
-- This script creates all necessary tables for the WMS system

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS wms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wms_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'employee') DEFAULT 'employee',
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL(10, 2) DEFAULT 0.00,
    stock_quantity INT DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'pcs',
    status ENUM('active', 'inactive', 'discontinued') DEFAULT 'active',
    product_type ENUM('domestic', 'international') DEFAULT 'domestic',
    hsn_code VARCHAR(20),
    gst_rate DECIMAL(5, 2) DEFAULT 0.00,
    rack VARCHAR(50) DEFAULT NULL,
    images JSON DEFAULT NULL,
    low_stock_threshold INT DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sku (sku),
    INDEX idx_name (name),
    INDEX idx_category (category),
    INDEX idx_status (status),
    INDEX idx_product_type (product_type)
);

-- Barcodes table
CREATE TABLE IF NOT EXISTS barcodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    barcode VARCHAR(50) UNIQUE NOT NULL,
    units_assigned INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_barcode (barcode),
    INDEX idx_product_id (product_id),
    INDEX idx_created_at (created_at)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('in', 'out', 'transfer', 'adjustment') NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) DEFAULT 0.00,
    total_amount DECIMAL(10, 2) DEFAULT 0.00,
    reference_number VARCHAR(100),
    notes TEXT,
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_type (type),
    INDEX idx_product_id (product_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at),
    INDEX idx_reference_number (reference_number)
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    quantity INT DEFAULT 0,
    reserved_quantity INT DEFAULT 0,
    available_quantity INT GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_product (product_id),
    INDEX idx_quantity (quantity),
    INDEX idx_available_quantity (available_quantity)
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('low_stock', 'out_of_stock', 'expiry_warning', 'system') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    product_id INT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_type (type),
    INDEX idx_is_read (is_read),
    INDEX idx_priority (priority),
    INDEX idx_created_at (created_at)
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type ENUM('inventory', 'transactions', 'products', 'custom') NOT NULL,
    parameters JSON,
    generated_by INT,
    file_path VARCHAR(500),
    status ENUM('pending', 'generating', 'completed', 'failed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- Insert default admin user
INSERT IGNORE INTO users (username, email, password_hash, role, first_name, last_name) 
VALUES ('admin', 'admin@wms.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 'Admin', 'User');

-- Insert sample products
INSERT IGNORE INTO products (name, sku, description, category, price, stock_quantity, unit) VALUES
('Sample Product 1', 'SKU001', 'This is a sample product for testing', 'Electronics', 29.99, 100, 'pcs'),
('Sample Product 2', 'SKU002', 'Another sample product', 'Clothing', 19.99, 50, 'pcs'),
('Sample Product 3', 'SKU003', 'Third sample product', 'Books', 9.99, 200, 'pcs');

-- Create triggers to update inventory when products are modified
DELIMITER //

CREATE TRIGGER IF NOT EXISTS update_inventory_on_product_insert
AFTER INSERT ON products
FOR EACH ROW
BEGIN
    INSERT INTO inventory (product_id, quantity) 
    VALUES (NEW.id, NEW.stock_quantity)
    ON DUPLICATE KEY UPDATE quantity = NEW.stock_quantity;
END//

CREATE TRIGGER IF NOT EXISTS update_inventory_on_product_update
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
    UPDATE inventory 
    SET quantity = NEW.stock_quantity 
    WHERE product_id = NEW.id;
END//

CREATE TRIGGER IF NOT EXISTS update_inventory_on_transaction_insert
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
    IF NEW.type = 'in' THEN
        UPDATE inventory 
        SET quantity = quantity + NEW.quantity 
        WHERE product_id = NEW.product_id;
    ELSEIF NEW.type = 'out' THEN
        UPDATE inventory 
        SET quantity = quantity - NEW.quantity 
        WHERE product_id = NEW.product_id;
    END IF;
END//

DELIMITER ;

-- Create views for common queries
CREATE OR REPLACE VIEW product_inventory_view AS
SELECT 
    p.id,
    p.name,
    p.sku,
    p.category,
    p.price,
    p.stock_quantity,
    p.unit,
    p.status,
    COALESCE(i.quantity, 0) as current_quantity,
    COALESCE(i.reserved_quantity, 0) as reserved_quantity,
    COALESCE(i.available_quantity, 0) as available_quantity,
    p.created_at,
    p.updated_at
FROM products p
LEFT JOIN inventory i ON p.id = i.product_id;

-- Create indexes for better performance
CREATE INDEX idx_products_name_sku ON products(name, sku);
CREATE INDEX idx_barcodes_product_barcode ON barcodes(product_id, barcode);
CREATE INDEX idx_transactions_product_type ON transactions(product_id, type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_alerts_type_read ON alerts(type, is_read);

-- Grant permissions (adjust as needed for your MySQL user)
-- GRANT ALL PRIVILEGES ON wms_db.* TO 'your_mysql_user'@'localhost';
-- FLUSH PRIVILEGES;

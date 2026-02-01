const fs = require('fs');
const path = require('path');
const { pool, getDatabaseConfig } = require('../config/database');
const mysql = require('mysql2/promise');

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    // Create a specific connection for migration to enable multipleStatements
    const config = getDatabaseConfig();
    const connection = await mysql.createConnection({
      ...config,
      multipleStatements: true
    });

    try {
        const schemaSQL = fs.readFileSync(
          path.join(__dirname, 'create-mysql-schema.sql'),
          'utf8'
        );
        
        // Remove DELIMITER commands as they are client-side only and not needed for driver execution
        // Also replace custom delimiters // with ; if necessary, but the driver generally handles parsing if multipleStatements is true
        // and we remove the DELIMITER lines.
        // Actually, for triggers, we need to be careful.
        // Simple approach: Remove "DELIMITER //" and "DELIMITER ;" lines.
        // Replace "//" at end of blocks with ";"
        
        let cleanSQL = schemaSQL
            .replace(/DELIMITER \/\//g, '')
            .replace(/DELIMITER ;/g, '')
            .replace(/\/\/$/gm, ';'); // Replace // at end of lines with ;

        await connection.query(cleanSQL);
        console.log('Database schema created successfully!');
    } finally {
        await connection.end();
    }
    
    // Insert default admin user
    const bcrypt = require('bcryptjs');
    const defaultPassword = await bcrypt.hash('admin123', 10);
    
    await pool.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@wms.com', ?, 'admin')
      ON DUPLICATE KEY UPDATE id=id
    `, [defaultPassword]);
    // Note: ON CONFLICT is Postgres, MySQL uses ON DUPLICATE KEY UPDATE or INSERT IGNORE
    // schema.sql user insert uses INSERT IGNORE, so maybe we don't need this block if schema includes it?
    // create-mysql-schema.sql ALREADY inserts admin user. So we should probably skip this or wrap in try/catch or use valid MySQL syntax.
    // The schema file has: INSERT IGNORE INTO users ...
    
    console.log('Default admin user check completed.');
    
    // Insert sample data
    await insertSampleData();
    
    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}


async function insertSampleData() {
  try {
    // Insert sample products
    const products = [
      { 
        name: 'Laptop Computer', 
        sku: 'LAP001', 
        price: 999.99, 
        initial_stock: 50,
        hsn_code: '84713000',
        gst_rate: 18,
        origin: 'China' 
      },
      { 
        name: 'Wireless Mouse', 
        sku: 'MOU001', 
        price: 29.99, 
        initial_stock: 100,
        hsn_code: '84716000',
        gst_rate: 18,
        origin: 'Taiwan' 
      },
      { 
        name: 'USB Cable', 
        sku: 'CAB001', 
        price: 9.99, 
        initial_stock: 200,
        hsn_code: '85444900',
        gst_rate: 18,
        origin: 'China' 
      },
      { 
        name: 'Monitor 24"', 
        sku: 'MON001', 
        price: 299.99, 
        initial_stock: 25,
        hsn_code: '85285200',
        gst_rate: 18,
        origin: 'South Korea' 
      },
      { 
        name: 'Keyboard Mechanical', 
        sku: 'KEY001', 
        price: 89.99, 
        initial_stock: 75,
        hsn_code: '84716000',
        gst_rate: 18,
        origin: 'Germany' 
      }
    ];
    
    for (const product of products) {
      // First check if the product already exists
      const [existingProduct] = await pool.query('SELECT id FROM products WHERE sku = ?', [product.sku]);
      
      if (existingProduct.length === 0) {
        await pool.query(`
          INSERT INTO products (name, sku, price, initial_stock, current_stock, hsn_code, gst_rate, low_stock_threshold)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [product.name, product.sku, product.price, product.initial_stock, product.initial_stock, product.hsn_code, product.gst_rate, 10]);
      }
    }
    
    console.log('Sample products inserted');
    
    // Insert sample barcodes
    const barcodes = [
      { sku: 'LAP001', barcode: '1234567890123', units: 50 },
      { sku: 'LAP001', barcode: '1234567890124', units: 30 },
      { sku: 'MOU001', barcode: '2345678901234', units: 100 },
      { sku: 'CAB001', barcode: '3456789012345', units: 200 },
      { sku: 'MON001', barcode: '4567890123456', units: 25 },
      { sku: 'KEY001', barcode: '5678901234567', units: 75 }
    ];
    
    for (const barcode of barcodes) {
      const [productResult] = await pool.query('SELECT id FROM products WHERE sku = ?', [barcode.sku]);
      if (productResult.length > 0) {
        const productId = productResult[0].id;
        
        await pool.query(`
          INSERT INTO barcodes (product_id, barcode, units_assigned)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE id=id
        `, [productId, barcode.barcode, barcode.units]);
        
        // Insert initial stock transaction
        const [barcodeResult] = await pool.query('SELECT id FROM barcodes WHERE barcode = ?', [barcode.barcode]);
        if (barcodeResult.length > 0) {
          const barcodeId = barcodeResult[0].id;
          
          await pool.query(`
            INSERT INTO stock_transactions (product_id, barcode_id, transaction_type, quantity, reference_number, notes, created_by)
            VALUES (?, ?, 'IN', ?, 'INITIAL_STOCK', 'Initial stock entry', 'system')
          `, [productId, barcodeId, barcode.units]);
        }
      }
    }
    
    console.log('Sample barcodes and initial stock inserted');
    
  } catch (error) {
    console.error('Error inserting sample data:', error);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
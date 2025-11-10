const { pool } = require('../config/database');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function addRackColumn() {
  let connection;
  try {
    console.log('🔍 Checking if rack column exists...');
    
    connection = await pool.getConnection();
    
    // Check if column exists
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'products' 
       AND COLUMN_NAME = 'rack'`
    );

    if (columns.length > 0) {
      console.log('✅ Rack column already exists in products table');
      return;
    }

    console.log('📝 Adding rack column to products table...');
    
    // Add rack column
    await connection.execute(
      `ALTER TABLE products 
       ADD COLUMN rack VARCHAR(50) DEFAULT NULL AFTER gst_rate`
    );

    console.log('✅ Successfully added rack column to products table');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

// Run the migration
addRackColumn();


const { pool } = require('../config/database');

async function addCustomerNameColumn() {
  try {
    console.log('Adding customer_name column to labels table...');
    await pool.execute(`
      ALTER TABLE labels ADD COLUMN customer_name VARCHAR(255) AFTER order_number
    `);
    console.log('customer_name column added successfully.');
    process.exit(0);
  } catch (error) {
    // Column might already exist
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('customer_name column already exists.');
      process.exit(0);
    }
    console.error('Error adding column:', error);
    process.exit(1);
  }
}

addCustomerNameColumn();

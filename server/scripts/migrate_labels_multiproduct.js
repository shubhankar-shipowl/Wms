const { pool } = require('../config/database');

/**
 * Migration: Add multi-product support columns to labels table
 * - label_id: Groups products from same label (using order_number or generated)
 * - quantity: Product quantity from label table
 * - sku: Product SKU code
 * - price: Product price
 */
async function migrate() {
  try {
    console.log('Adding multi-product support columns to labels table...');

    // Add label_id column
    try {
      await pool.execute(`
        ALTER TABLE labels 
        ADD COLUMN label_id VARCHAR(100) AFTER id
      `);
      console.log('✅ Added label_id column');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  label_id column already exists');
      } else {
        throw e;
      }
    }

    // Add quantity column with default 1
    try {
      await pool.execute(`
        ALTER TABLE labels 
        ADD COLUMN quantity INT DEFAULT 1 AFTER product_name
      `);
      console.log('✅ Added quantity column');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  quantity column already exists');
      } else {
        throw e;
      }
    }

    // Add sku column
    try {
      await pool.execute(`
        ALTER TABLE labels 
        ADD COLUMN sku VARCHAR(255) AFTER product_name
      `);
      console.log('✅ Added sku column');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  sku column already exists');
      } else {
        throw e;
      }
    }

    // Add price column
    try {
      await pool.execute(`
        ALTER TABLE labels 
        ADD COLUMN price DECIMAL(10, 2) AFTER quantity
      `);
      console.log('✅ Added price column');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  price column already exists');
      } else {
        throw e;
      }
    }

    // Add index on label_id
    try {
      await pool.execute(`
        ALTER TABLE labels 
        ADD INDEX idx_label_id (label_id)
      `);
      console.log('✅ Added index on label_id');
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') {
        console.log('⏭️  idx_label_id index already exists');
      } else {
        throw e;
      }
    }

    // Backfill label_id from existing order_number or generate from id
    await pool.execute(`
      UPDATE labels 
      SET label_id = COALESCE(order_number, CONCAT('LABEL-', id))
      WHERE label_id IS NULL
    `);
    console.log('✅ Backfilled label_id for existing records');

    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();

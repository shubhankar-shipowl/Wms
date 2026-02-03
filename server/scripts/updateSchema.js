const { pool } = require("../config/database");

async function updateSchema() {
  try {
    console.log("Updating database schema...");

    // Check if product_type column exists
    const [checkColumn] = await pool.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'product_type'
    `);

    if (checkColumn.length === 0) {
      console.log("Adding product_type column...");
      await pool.execute(`
        ALTER TABLE products 
        ADD COLUMN product_type VARCHAR(20) DEFAULT 'domestic'
      `);

      // Update existing records
      await pool.execute(`
        UPDATE products 
        SET product_type = 'domestic' 
        WHERE product_type IS NULL
      `);

      console.log("product_type column added successfully");
    } else {
      console.log("product_type column already exists");
    }

    // Check if origin column exists and remove it
    const [checkOrigin] = await pool.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'origin'
    `);

    if (checkOrigin.length > 0) {
      console.log("Removing origin column...");
      await pool.execute("ALTER TABLE products DROP COLUMN origin");
      console.log("origin column removed successfully");
    } else {
      console.log("origin column does not exist");
    }

    // Check if description column exists
    const [checkDescription] = await pool.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'description'
    `);

    if (checkDescription.length === 0) {
      console.log("Adding description column...");
      await pool.execute("ALTER TABLE products ADD COLUMN description TEXT");
      console.log("description column added successfully");
    } else {
      console.log("description column already exists");
    }

    // Check if images column exists
    const [checkImages] = await pool.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'images'
    `);

    if (checkImages.length === 0) {
      console.log("Adding images column...");
      await pool.execute("ALTER TABLE products ADD COLUMN images JSON DEFAULT NULL");
      console.log("images column added successfully");
    } else {
      console.log("images column already exists");
    }

    // Check if order_number column exists in labels table
    const [checkOrderNumber] = await pool.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'labels' AND column_name = 'order_number'
    `);

    if (checkOrderNumber.length === 0) {
      console.log("Adding order_number column to labels table...");
      await pool.execute("ALTER TABLE labels ADD COLUMN order_number VARCHAR(100) DEFAULT NULL");
      // Add index for faster lookup (check if exists first in a real prod env, but here simpler)
      // MySQL allows ADD INDEX in ALTER TABLE usually
      await pool.execute("ALTER TABLE labels ADD INDEX idx_order_number (order_number)");
      console.log("order_number column added successfully");
    } else {
      console.log("order_number column already exists");
    }

    console.log("Database schema update completed successfully");
  } catch (error) {
    console.error("Error updating database schema:", error);
  }
}

module.exports = updateSchema;

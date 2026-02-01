const { pool } = require('../config/database');

async function createTable() {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS labels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_name VARCHAR(255) NOT NULL,
        courier_name VARCHAR(255) NOT NULL,
        product_name TEXT NOT NULL,
        order_number VARCHAR(100),
        label_date DATE,
        pdf_file_url TEXT NOT NULL,
        pdf_filename VARCHAR(255),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INT,
        INDEX idx_store (store_name),
        INDEX idx_courier (courier_name),
        INDEX idx_product (product_name(255))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Note: product_name is TEXT, so index needs length specification in MySQL

    console.log('Creating labels table...');
    await pool.execute(createTableQuery);
    console.log('Labels table created successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error creating table:', error);
    process.exit(1);
  }
}

createTable();

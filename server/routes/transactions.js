const express = require('express');
const Joi = require('joi');
const { pool, getTableName } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const transactionSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  type: Joi.string().valid('in', 'out').required(),
  quantity: Joi.number().integer().min(1).required(),
  reference_number: Joi.string().allow(''),
  notes: Joi.string().allow(''),
});

const bulkTransactionSchema = Joi.object({
  transactions: Joi.array().items(transactionSchema).min(1).max(100).required(),
});

// Get all transactions with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      product_id,
      product_name,
      type,
      start_date,
      end_date,
      reference_number,
      user_id,
    } = req.query;

    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    let query = `
      SELECT 
        t.*,
        p.name as product_name,
        p.sku as product_sku,
        u.username as created_by_username
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.user_id = u.id
    `;

    if (product_id) {
      conditions.push('t.product_id = ?');
      params.push(product_id);
    }

    if (product_name) {
      conditions.push('t.product_id = ?');
      params.push(product_name);
    }

    if (type) {
      conditions.push('t.type = ?');
      params.push(type);
    }

    if (start_date) {
      // Ensure we compare dates correctly, including transactions created at any time on the start date
      conditions.push('DATE(t.created_at) >= ?');
      params.push(start_date);
    }

    if (end_date) {
      // Ensure we compare dates correctly, including transactions created at any time on the end date
      conditions.push('DATE(t.created_at) <= ?');
      params.push(end_date);
    }

    if (reference_number) {
      conditions.push('t.reference_number LIKE ?');
      params.push(`%${reference_number}%`);
    }

    if (user_id) {
      conditions.push('t.user_id = ?');
      params.push(user_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY t.created_at DESC LIMIT ${parseInt(
      limit,
    )} OFFSET ${parseInt(offset)}`;

    // Debug logging
    if (start_date || end_date) {
      console.log('[TRANSACTIONS] Query:', query);
      console.log('[TRANSACTIONS] Params:', params);
    }

    const [transactions] = await pool.execute(query, params);
    
    // Debug logging
    if (start_date || end_date) {
      console.log(`[TRANSACTIONS] Found ${transactions.length} transactions for date range ${start_date || 'N/A'} to ${end_date || 'N/A'}`);
    }

    // Derive barcode number from notes when present (pattern: "Barcode: <digits>")
    const transactionsWithBarcode = transactions.map((t) => {
      let extractedBarcode = null;
      try {
        const match = (t.notes || '').match(/Barcode:\s*(\d+)/);
        extractedBarcode = match ? match[1] : null;
      } catch (_) {
        extractedBarcode = null;
      }
      return { ...t, barcode: extractedBarcode };
    });

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      JOIN products p ON t.product_id = p.id
    `;

    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }

    const [countResult] = await pool.execute(countQuery, params);

    res.json({
      success: true,
      data: {
        transactions: transactionsWithBarcode,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          pages: Math.ceil(countResult[0].total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Export transactions to CSV
router.get('/export/csv', authenticateToken, async (req, res) => {
  try {
    const {
      product_id,
      type,
      start_date,
      end_date,
      reference_number,
      user_id,
    } = req.query;

    const params = [];
    const conditions = [];

    let query = `
      SELECT 
        t.id,
        t.type,
        t.quantity,
        t.reference_number,
        t.notes,
        t.created_at,
        p.name as product_name,
        p.sku as product_sku,
        u.username as created_by_username
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.user_id = u.id
    `;

    if (product_id) {
      conditions.push('t.product_id = ?');
      params.push(product_id);
    }

    if (type) {
      conditions.push('t.type = ?');
      params.push(type);
    }

    if (start_date) {
      // Ensure we compare dates correctly, including transactions created at any time on the start date
      conditions.push('DATE(t.created_at) >= ?');
      params.push(start_date);
    }

    if (end_date) {
      // Ensure we compare dates correctly, including transactions created at any time on the end date
      conditions.push('DATE(t.created_at) <= ?');
      params.push(end_date);
    }

    if (reference_number) {
      conditions.push('t.reference_number LIKE ?');
      params.push(`%${reference_number}%`);
    }

    if (user_id) {
      conditions.push('t.user_id = ?');
      params.push(user_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY t.created_at DESC';

    const [transactions] = await pool.execute(query, params);

    // Generate CSV content
    const csvHeader = [
      'ID',
      'Date & Time',
      'Product Name',
      'SKU',
      'Type',
      'Quantity',
      'Barcode Number',
      'Created By',
    ].join(',');

    const csvRows = transactions.map((transaction) => {
      const date = new Date(transaction.created_at).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      // Extract barcode from notes (look for "Barcode: XXXXX" pattern)
      const barcodeMatch = (transaction.notes || '').match(/Barcode:\s*(\d+)/);
      const barcodeNumber = barcodeMatch ? barcodeMatch[1] : '';

      return [
        transaction.id,
        `"${date}"`,
        `"${transaction.product_name || ''}"`,
        `"${transaction.product_sku || ''}"`,
        `"${transaction.type?.toUpperCase() || ''}"`,
        transaction.quantity || 0,
        `"${barcodeNumber}"`,
        `"${transaction.created_by_username || ''}"`,
      ].join(',');
    });

    const csvContent = [csvHeader, ...csvRows].join('\n');

    // Set headers for CSV download
    const filename = `transactions_export_${
      new Date().toISOString().split('T')[0]
    }.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(csvContent);
  } catch (error) {
    console.error('Export transactions CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export transactions to CSV',
    });
  }
});

// Get transactions summary for dashboard
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { days = 30, product_id, start_date, end_date } = req.query;

    // Build WHERE clause for date filtering
    let whereClause = '';
    const params = [];

    if (start_date && end_date) {
      // Use specific date range - ensure we include all transactions on both dates
      whereClause = `DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`;
      params.push(start_date, end_date);
      console.log(
        `[TRANSACTIONS] Date range filter: ${start_date} to ${end_date}`,
      );
    } else if (start_date) {
      // Use start date to today - ensure we include all transactions on the start date
      whereClause = `DATE(t.created_at) >= ?`;
      params.push(start_date);
      console.log(`[TRANSACTIONS] Start date filter: ${start_date}`);
    } else if (end_date) {
      // Use end date from beginning of time - ensure we include all transactions on the end date
      whereClause = `DATE(t.created_at) <= ?`;
      params.push(end_date);
      console.log(`[TRANSACTIONS] End date filter: ${end_date}`);
    } else {
      // Use days parameter (default behavior)
      whereClause = `t.created_at >= DATE_SUB(CURDATE(), INTERVAL ${parseInt(
        days,
      )} DAY)`;
      console.log(`[TRANSACTIONS] Days filter: ${days} days`);
    }

    if (product_id) {
      whereClause += ` AND t.product_id = ?`;
      params.push(product_id);
    }

    // Get total transactions in the last N days
    const [totalResult] = await pool.execute(
      `
      SELECT COUNT(*) as total_transactions
      FROM transactions t
      WHERE ${whereClause}
    `,
      params,
    );

    // Get transaction quantities
    const [stockInResult] = await pool.execute(
      `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END), 0) as stock_in_quantity,
        COALESCE(SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END), 0) as stock_out_quantity
      FROM transactions t
      WHERE ${whereClause}
    `,
      params,
    );

    // Get individual quantities from filtered transactions
    const stockInQuantity = parseInt(stockInResult[0].stock_in_quantity);
    const stockOutQuantity = parseInt(stockInResult[0].stock_out_quantity);

    // Determine what to show for stock_in based on filtering
    let stockInDisplay = 0;
    let currentStock = 0;
    let netStock = 0;

    if (product_id) {
      // For specific product, get its current stock
      const [productResult] = await pool.execute(
        `SELECT stock_quantity FROM products WHERE id = ?`,
        [product_id],
      );
      currentStock =
        productResult.length > 0
          ? parseInt(productResult[0].stock_quantity)
          : 0;

      // If filtering by date range, show actual stock IN from transactions
      // If no date filter, show current stock
      if (start_date || end_date) {
        stockInDisplay = stockInQuantity; // Show actual stock IN from filtered transactions
      } else {
        stockInDisplay = currentStock; // Show current stock for all time
      }
      netStock = currentStock - stockOutQuantity;
    } else {
      // For all products
      const [allProductsResult] = await pool.execute(
        `SELECT COALESCE(SUM(stock_quantity), 0) as total_current_stock FROM products`,
      );
      currentStock = parseInt(allProductsResult[0].total_current_stock);

      // If filtering by date range, show actual stock IN from transactions
      // If no date filter, show current stock
      if (start_date || end_date) {
        stockInDisplay = stockInQuantity; // Show actual stock IN from filtered transactions
      } else {
        stockInDisplay = currentStock; // Show current stock for all time
      }
      netStock = currentStock - stockOutQuantity;
    }

    // Total quantity moved should be the sum of all quantities (both IN and OUT)
    // This represents the total movement/activity, not net change
    const totalQuantityMoved = stockInQuantity + stockOutQuantity;

    const responseData = {
      success: true,
      data: {
        total_transactions: totalResult[0].total_transactions,
        stock_in: stockInDisplay, // Show appropriate value based on filtering
        stock_out: stockOutQuantity, // Show actual OUT quantity
        total_quantity_moved: totalQuantityMoved,
        gross_stock_in: stockInQuantity, // Add gross IN quantity as separate field for reference
        net_stock: netStock, // Add net stock calculation as separate field for reference
        current_stock: currentStock, // Add current stock as separate field for reference
        period_days: parseInt(days),
        product_id: product_id || null,
        is_date_filtered: !!(start_date || end_date), // Indicate if date filtering is applied
      },
    };

    console.log(
      `[TRANSACTIONS] API Response for date range ${start_date} to ${end_date}:`,
      JSON.stringify(responseData, null, 2),
    );

    res.json(responseData);
  } catch (error) {
    console.error('Get transactions summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Create new transaction
router.post('/', authenticateToken, async (req, res) => {
  let connection;
  try {
    const { error } = transactionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const {
      product_id,
      type,
      quantity,
      reference_number = '',
      notes = '',
    } = req.body;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if product exists
    const [productRows] = await connection.execute(
      'SELECT id, name, sku FROM products WHERE id = ?',
      [product_id],
    );

    if (productRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Create transaction
    const [result] = await connection.execute(
      `INSERT INTO products (product_id, type, quantity, reference_number, notes, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [product_id, type, quantity, reference_number, notes, req.user.id],
    );

    const transactionId = result.insertId;

    // UPDATE products
    const [inventoryRows] = await connection.execute(
      'SELECT id, quantity FROM products WHERE product_id = ?',
      [product_id],
    );

    if (inventoryRows.length > 0) {
      // Update existing inventory
      const currentQuantity = inventoryRows[0].quantity;
      const newQuantity =
        type === 'in'
          ? currentQuantity + quantity
          : Math.max(0, currentQuantity - quantity);

      await connection.execute(
        'UPDATE products SET quantity = ?, last_updated = NOW() WHERE product_id = ?',
        [newQuantity, product_id],
      );

      // Update product stock_quantity
      await connection.execute(
        'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
        [newQuantity, product_id],
      );
    } else if (type === 'in') {
      // Create new inventory record for incoming stock
      await connection.execute(
        'INSERT INTO products (product_id, quantity, last_updated) VALUES (?, ?, NOW())',
        [product_id, quantity],
      );

      // Update product stock_quantity
      await connection.execute(
        'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
        [quantity, product_id],
      );
    }

    await connection.commit();

    // Get the created transaction
    const [transactionRows] = await connection.execute(
      'SELECT * FROM products WHERE id = ?',
      [transactionId],
    );

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transactionRows[0],
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Create transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Create bulk transactions
router.post(
  '/bulk',
  authenticateToken,
  requireRole(['admin', 'manager']),
  async (req, res) => {
    let connection;
    try {
      const { error } = bulkTransactionSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      const { transactions } = req.body;

      connection = await pool.getConnection();
      await connection.beginTransaction();

      const createdTransactions = [];

      for (const transaction of transactions) {
        const {
          product_id,
          type,
          quantity,
          reference_number = '',
          notes = '',
        } = transaction;

        // Check if product exists
        const [productRows] = await connection.execute(
          'SELECT id FROM products WHERE id = ?',
          [product_id],
        );

        if (productRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Product with ID ${product_id} not found`,
          });
        }

        // Create transaction
        const [result] = await connection.execute(
          `INSERT INTO products (product_id, type, quantity, reference_number, notes, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [product_id, type, quantity, reference_number, notes, req.user.id],
        );

        createdTransactions.push(result.insertId);

        // UPDATE products
        const [inventoryRows] = await connection.execute(
          'SELECT id, quantity FROM products WHERE product_id = ?',
          [product_id],
        );

        if (inventoryRows.length > 0) {
          const currentQuantity = inventoryRows[0].quantity;
          const newQuantity =
            type === 'in'
              ? currentQuantity + quantity
              : Math.max(0, currentQuantity - quantity);

          await connection.execute(
            'UPDATE products SET quantity = ?, last_updated = NOW() WHERE product_id = ?',
            [newQuantity, product_id],
          );

          await connection.execute(
            'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
            [newQuantity, product_id],
          );
        } else if (type === 'in') {
          await connection.execute(
            'INSERT INTO products (product_id, quantity, last_updated) VALUES (?, ?, NOW())',
            [product_id, quantity],
          );

          await connection.execute(
            'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
            [quantity, product_id],
          );
        }
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: `${transactions.length} transactions created successfully`,
        data: { created_count: createdTransactions.length },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Create bulk transactions error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

// Get transaction by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [transactionRows] = await pool.execute(
      `SELECT 
        t.*,
        p.name as product_name,
        p.sku as product_sku,
        u.username as created_by_username
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = ?`,
      [id],
    );

    if (transactionRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.json({
      success: true,
      data: transactionRows[0],
    });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Update transaction
router.put(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'manager']),
  async (req, res) => {
    let connection;
    try {
      const { id } = req.params;
      const { type, quantity, reference_number, notes } = req.body;

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Get existing transaction
      const [existingRows] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        });
      }

      const existing = existingRows[0];

      // Update transaction
      await connection.execute(
        'UPDATE products SET type = ?, quantity = ?, reference_number = ?, notes = ?, updated_at = NOW() WHERE id = ?',
        [type, quantity, reference_number, notes, id],
      );

      // Recalculate inventory if quantity or type changed
      if (quantity !== existing.quantity || type !== existing.type) {
        // Revert old transaction
        const oldQuantity =
          existing.type === 'in' ? existing.quantity : -existing.quantity;

        // Apply new transaction
        const newQuantity = type === 'in' ? quantity : -quantity;

        const netChange = newQuantity - oldQuantity;

        if (netChange !== 0) {
          const [inventoryRows] = await connection.execute(
            'SELECT quantity FROM products WHERE product_id = ?',
            [existing.product_id],
          );

          if (inventoryRows.length > 0) {
            const currentQuantity = inventoryRows[0].quantity;
            const newInventoryQuantity = Math.max(
              0,
              currentQuantity + netChange,
            );

            await connection.execute(
              'UPDATE products SET quantity = ?, last_updated = NOW() WHERE product_id = ?',
              [newInventoryQuantity, existing.product_id],
            );

            await connection.execute(
              'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
              [newInventoryQuantity, existing.product_id],
            );
          }
        }
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'Transaction updated successfully',
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Update transaction error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

// Delete transaction
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    let connection;
    try {
      const { id } = req.params;

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Get existing transaction
      const [existingRows] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        });
      }

      const existing = existingRows[0];

      // Revert inventory changes
      const quantityChange =
        existing.type === 'in' ? -existing.quantity : existing.quantity;

      const [inventoryRows] = await connection.execute(
        'SELECT quantity FROM products WHERE product_id = ?',
        [existing.product_id],
      );

      if (inventoryRows.length > 0) {
        const currentQuantity = inventoryRows[0].quantity;
        const newQuantity = Math.max(0, currentQuantity + quantityChange);

        await connection.execute(
          'UPDATE products SET quantity = ?, last_updated = NOW() WHERE product_id = ?',
          [newQuantity, existing.product_id],
        );

        await connection.execute(
          'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
          [newQuantity, existing.product_id],
        );
      }

      // Delete transaction
      await connection.execute('DELETE FROM products WHERE id = ?', [id]);

      await connection.commit();

      res.json({
        success: true,
        message: 'Transaction deleted successfully',
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Delete transaction error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

module.exports = router;

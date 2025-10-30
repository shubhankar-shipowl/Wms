const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { pool, getTableName } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const printerService = require('../services/printerService');

const router = express.Router();

// Validation schemas
const barcodeSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  barcode: Joi.string().required(),
  units_assigned: Joi.number().integer().min(0).default(0),
});

const bulkBarcodeSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  quantity: Joi.number().integer().min(1).max(1000).required(),
  units_per_barcode: Joi.number().integer().min(0).default(0),
  distribution_type: Joi.string().valid('equal', 'manual').default('equal'),
  manual_distribution: Joi.array()
    .items(Joi.number().integer().min(0))
    .optional(),
});

const suggestionResponseSchema = Joi.object({
  suggestion_id: Joi.number().integer().required(),
  action: Joi.string().valid('accept', 'reject', 'modify').required(),
  modified_quantity: Joi.number().integer().min(1).optional(),
  admin_notes: Joi.string().allow('').optional(),
});

// Generate unique barcode number with consistent length
function generateBarcodeNumber() {
  // Use a fixed-length timestamp (13 digits) + random (5 digits) = 18 digits total
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');

  // Ensure consistent 18-digit length
  const barcode = timestamp + random;
  return barcode.padStart(18, '0').slice(-18); // Take last 18 digits
}

// Get all barcodes with pagination and filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit,
      search = '',
      product_id,
      sort_by = 'created_at',
      sort_order = 'desc',
      stock_status, // 'in' | 'out' optional for faster filtering
    } = req.query;

    // Use pagination with the provided limit
    const limitValue = parseInt(limit) || 10;
    const offset = (parseInt(page) - 1) * limitValue;
    let whereClause = 'WHERE 1=1';
    const params = [];

    // Add search filter
    if (search) {
      whereClause += ' AND (b.barcode LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Add product filter
    if (product_id) {
      whereClause += ' AND b.product_id = ?';
      params.push(product_id);
    }

    // Add stock status filter (server-side for performance)
    if (stock_status === 'in') {
      // Units assigned > 0 OR explicitly marked stocked in
      whereClause += ' AND (b.units_assigned > 0 OR b.is_stocked_in = 1)';
    } else if (stock_status === 'out') {
      // Units assigned = 0 or NULL considered stock out
      whereClause += ' AND (b.units_assigned = 0 OR b.units_assigned IS NULL)';
    }

    // Build query with scan history
    let query = `
      SELECT 
        b.*,
        p.name as product_name,
        p.sku as product_sku,
        '' as product_description,
        p.category as product_category,
        p.price as product_price,
        p.stock_quantity as product_stock,
        p.unit as product_unit,
        p.status as product_status,
        p.created_at as product_created_at,
        p.updated_at as product_updated_at,
        (SELECT COUNT(*) FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.type = 'in' 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')) as stock_in_count,
        (SELECT COUNT(*) FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.type = 'out' 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')) as stock_out_count,
        (SELECT t.created_at FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')
         ORDER BY t.created_at DESC LIMIT 1) as last_scan_date
      FROM barcodes b
      LEFT JOIN products p ON b.product_id = p.id
      ${whereClause}
      ORDER BY b.${sort_by} ${sort_order}
    `;

    // Add pagination
    query += ` LIMIT ${limitValue} OFFSET ${offset}`;

    const [barcodes] = await pool.execute(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM barcodes b
      LEFT JOIN products p ON b.product_id = p.id
      ${whereClause}
    `;

    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        barcodes,
        pagination: {
          page: parseInt(page),
          limit: limitValue,
          total,
          pages: Math.ceil(total / limitValue),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching barcodes:', error);
    res.status(500).json({ error: 'Failed to fetch barcodes' });
  }
});

// Get barcode by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT 
        b.*,
        p.name as product_name,
        p.sku as product_sku,
        '' as product_description,
        p.category as product_category,
        p.price as product_price,
        p.stock_quantity as product_stock,
        p.unit as product_unit,
        p.status as product_status,
        p.created_at as product_created_at,
        p.updated_at as product_updated_at,
        (SELECT COUNT(*) FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.type = 'in' 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')) as stock_in_count,
        (SELECT COUNT(*) FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.type = 'out' 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')) as stock_out_count,
        (SELECT t.created_at FROM transactions t 
         WHERE t.product_id = b.product_id 
         AND t.notes LIKE CONCAT('%Barcode: ', b.barcode, '%')
         ORDER BY t.created_at DESC LIMIT 1) as last_scan_date
      FROM barcodes b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Barcode not found' });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error('Error fetching barcode:', error);
    res.status(500).json({ error: 'Failed to fetch barcode' });
  }
});

// Create new barcode
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'manager']),
  async (req, res) => {
    try {
      const { error, value } = barcodeSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { product_id, barcode, units_assigned } = value;

      // Check if barcode already exists
      const [existingBarcodes] = await pool.execute(
        'SELECT id FROM barcodes WHERE barcode = ?',
        [barcode],
      );

      if (existingBarcodes.length > 0) {
        return res.status(400).json({ error: 'Barcode already exists' });
      }

      // Check if product exists
      const [productRows] = await pool.execute(
        'SELECT id FROM products WHERE id = ?',
        [product_id],
      );

      if (productRows.length === 0) {
        return res.status(400).json({ error: 'Product not found' });
      }

      // Create barcode
      const [result] = await pool.execute(
        'INSERT INTO barcodes (product_id, barcode, units_assigned, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
        [product_id, barcode, units_assigned],
      );

      const barcodeId = result.insertId;

      // Get the created barcode with product details
      const [newBarcode] = await pool.execute(
        `SELECT 
        b.*,
        p.name as product_name,
        p.sku as product_sku,
        '' as product_description,
        p.category as product_category,
        p.price as product_price,
        p.stock_quantity as product_stock,
        p.unit as product_unit,
        p.status as product_status,
        p.created_at as product_created_at,
        p.updated_at as product_updated_at
      FROM barcodes b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?`,
        [barcodeId],
      );

      res.status(201).json({
        success: true,
        message: 'Barcode created successfully',
        data: newBarcode[0],
      });
    } catch (error) {
      console.error('Error creating barcode:', error);
      res.status(500).json({ error: 'Failed to create barcode' });
    }
  },
);

// Generate barcodes
router.post(
  '/generate',
  authenticateToken,
  requireRole(['admin', 'manager']),
  async (req, res) => {
    try {
      const { error, value } = bulkBarcodeSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const {
        product_id,
        quantity,
        units_per_barcode,
        distribution_type,
        manual_distribution,
      } = value;

      // Check if product exists
      const [productRows] = await pool.execute(
        'SELECT id FROM products WHERE id = ?',
        [product_id],
      );

      if (productRows.length === 0) {
        return res.status(400).json({ error: 'Product not found' });
      }

      // Generate barcodes with progress tracking
      const barcodes = [];
      const batchSize = 100; // Process in batches to avoid memory issues

      for (let i = 0; i < quantity; i += batchSize) {
        const currentBatchSize = Math.min(batchSize, quantity - i);
        const batch = [];

        for (let j = 0; j < currentBatchSize; j++) {
          const barcodeNumber = generateBarcodeNumber();
          batch.push({
            product_id,
            barcode: barcodeNumber,
            units_assigned: units_per_barcode,
          });
        }

        barcodes.push(...batch);

        // Add a small delay to prevent blocking
        if (i + batchSize < quantity) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Insert barcodes in bulk
      const values = barcodes
        .map(() => '(?, ?, ?, 0, NOW(), NOW())')
        .join(', ');
      const params = barcodes.flatMap((b) => [
        b.product_id,
        b.barcode,
        b.units_assigned,
      ]);

      await pool.execute(
        `INSERT INTO barcodes (product_id, barcode, units_assigned, is_stocked_in, created_at, updated_at) VALUES ${values}`,
        params,
      );

      // Update product stock quantity to match the sum of units_assigned for stocked-in barcodes
      const [stockedInData] = await pool.execute(
        `SELECT SUM(units_assigned) as total_units FROM barcodes WHERE product_id = ? AND is_stocked_in = 1`,
        [product_id],
      );

      const totalUnits = stockedInData[0].total_units || 0;

      await pool.execute(
        `UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?`,
        [totalUnits, product_id],
      );

      res.json({
        success: true,
        message: `${quantity} barcodes generated successfully`,
        data: {
          barcodes: barcodes.map((b) => b.barcode),
          quantity,
        },
      });
    } catch (error) {
      console.error('Error generating barcodes:', error);
      res.status(500).json({ error: 'Failed to generate barcodes' });
    }
  },
);

// Update barcode
router.put(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'manager']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { error, value } = barcodeSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { product_id, barcode, units_assigned } = value;

      // Check if barcode exists
      const [existingBarcodes] = await pool.execute(
        'SELECT id FROM products WHERE id = ?',
        [id],
      );

      if (existingBarcodes.length === 0) {
        return res.status(404).json({ error: 'Barcode not found' });
      }

      // Check if new barcode already exists (excluding current one)
      const [duplicateBarcodes] = await pool.execute(
        'SELECT id FROM barcodes WHERE barcode = ? AND id != ?',
        [barcode, id],
      );

      if (duplicateBarcodes.length > 0) {
        return res.status(400).json({ error: 'Barcode already exists' });
      }

      // Update barcode
      await pool.execute(
        'UPDATE barcodes SET product_id = ?, barcode = ?, units_assigned = ?, updated_at = NOW() WHERE id = ?',
        [product_id, barcode, units_assigned, id],
      );

      // Get updated barcode with product details
      const [updatedBarcode] = await pool.execute(
        `SELECT 
        b.*,
        p.name as product_name,
        p.sku as product_sku,
        '' as product_description,
        p.category as product_category,
        p.price as product_price,
        p.stock_quantity as product_stock,
        p.unit as product_unit,
        p.status as product_status,
        p.created_at as product_created_at,
        p.updated_at as product_updated_at
      FROM barcodes b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?`,
        [id],
      );

      res.json({
        success: true,
        message: 'Barcode updated successfully',
        data: updatedBarcode[0],
      });
    } catch (error) {
      console.error('Error updating barcode:', error);
      res.status(500).json({ error: 'Failed to update barcode' });
    }
  },
);

// Delete barcode
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Check if barcode exists
      const [existingBarcodes] = await pool.execute(
        'SELECT id FROM barcodes WHERE id = ?',
        [id],
      );

      if (existingBarcodes.length === 0) {
        return res.status(404).json({ error: 'Barcode not found' });
      }

      // Get product_id before deleting
      const [barcodeInfo] = await pool.execute(
        'SELECT product_id FROM barcodes WHERE id = ?',
        [id],
      );
      const product_id = barcodeInfo[0].product_id;

      // Delete barcode
      await pool.execute('DELETE FROM barcodes WHERE id = ?', [id]);

      // Update product stock quantity
      const [remainingBarcodes] = await pool.execute(
        'SELECT COUNT(*) as count FROM barcodes WHERE product_id = ? AND is_stocked_in = 1',
        [product_id],
      );

      await pool.execute(
        'UPDATE products SET stock_quantity = ? WHERE id = ?',
        [remainingBarcodes[0].count, product_id],
      );

      res.json({
        success: true,
        message: 'Barcode deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting barcode:', error);
      res.status(500).json({ error: 'Failed to delete barcode' });
    }
  },
);

// Bulk delete barcodes
router.delete(
  '/',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { barcode_ids } = req.body;

      if (!Array.isArray(barcode_ids) || barcode_ids.length === 0) {
        return res.status(400).json({ error: 'Barcode IDs array is required' });
      }

      const placeholders = barcode_ids.map(() => '?').join(',');
      const [result] = await pool.execute(
        `DELETE FROM barcodes WHERE id IN (${placeholders})`,
        barcode_ids,
      );

      res.json({
        success: true,
        message: `${result.affectedRows} barcodes deleted successfully`,
      });
    } catch (error) {
      console.error('Error bulk deleting barcodes:', error);
      res.status(500).json({ error: 'Failed to delete barcodes' });
    }
  },
);

module.exports = router;

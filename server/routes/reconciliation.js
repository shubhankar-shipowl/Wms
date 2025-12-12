const express = require('express');
const Joi = require('joi');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schema for reconciliation
const reconciliationSchema = Joi.object({
  product_id: Joi.number().integer().required(),
  scanned_barcodes: Joi.array()
    .items(Joi.string().trim())
    .min(1)
    .max(1000)
    .required()
    .messages({
      'array.max': 'Maximum 1000 barcodes allowed per reconciliation',
      'array.min': 'At least 1 barcode is required',
    }),
});

/**
 * Perform stock reconciliation
 * Compares scanned barcodes with database barcodes for a product
 * Returns: matched, missing (in DB but not scanned), and extra (scanned but not in DB)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { error, value } = reconciliationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { product_id, scanned_barcodes } = value;

    // Clean and trim scanned barcodes
    const cleanedScannedBarcodes = scanned_barcodes
      .map((b) => String(b).trim())
      .filter((b) => b.length > 0);

    if (cleanedScannedBarcodes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid barcodes provided',
      });
    }

    // Additional check for maximum limit (in case validation was bypassed)
    if (cleanedScannedBarcodes.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 1000 barcodes allowed per reconciliation request',
      });
    }

    // Get product details
    const [productRows] = await pool.execute(
      'SELECT id, name, sku, stock_quantity FROM products WHERE id = ?',
      [product_id]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const product = productRows[0];

    // Get all barcodes for this product that are currently stocked in
    const [dbBarcodes] = await pool.execute(
      `
      SELECT 
        b.id,
        b.barcode,
        b.units_assigned,
        b.is_stocked_in,
        b.created_at
      FROM barcodes b
      WHERE b.product_id = ?
        AND b.is_stocked_in = TRUE
      ORDER BY b.barcode
    `,
      [product_id]
    );

    // Create sets for comparison
    const scannedSet = new Set(cleanedScannedBarcodes);
    const dbBarcodeSet = new Set(dbBarcodes.map((b) => b.barcode));

    // Find matched barcodes (in both DB and scanned)
    const matched = dbBarcodes.filter((b) => scannedSet.has(b.barcode));

    // Find missing barcodes (in DB but not scanned - physically missing)
    const missing = dbBarcodes.filter((b) => !scannedSet.has(b.barcode));

    // Find extra barcodes (scanned but not in DB for this product)
    const extraBarcodes = [];
    for (const scannedBarcode of cleanedScannedBarcodes) {
      if (!dbBarcodeSet.has(scannedBarcode)) {
        // Check if this barcode exists for a different product
        const [barcodeInfo] = await pool.execute(
          `
          SELECT 
            b.barcode,
            b.product_id,
            p.name as product_name,
            p.sku as product_sku
          FROM barcodes b
          JOIN products p ON b.product_id = p.id
          WHERE b.barcode = ?
        `,
          [scannedBarcode]
        );

        if (barcodeInfo.length > 0) {
          extraBarcodes.push({
            barcode: scannedBarcode,
            belongs_to_product: {
              id: barcodeInfo[0].product_id,
              name: barcodeInfo[0].product_name,
              sku: barcodeInfo[0].product_sku,
            },
            message: `This barcode belongs to product: ${barcodeInfo[0].product_name} (${barcodeInfo[0].product_sku})`,
          });
        } else {
          extraBarcodes.push({
            barcode: scannedBarcode,
            belongs_to_product: null,
            message: 'Barcode not found in system',
          });
        }
      }
    }

    // Calculate summary
    const summary = {
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        system_stock: product.stock_quantity,
      },
      scanned_count: cleanedScannedBarcodes.length,
      system_stocked_in_count: dbBarcodes.length,
      matched_count: matched.length,
      missing_count: missing.length,
      extra_count: extraBarcodes.length,
      discrepancy: dbBarcodes.length - cleanedScannedBarcodes.length,
    };

    res.json({
      success: true,
      message: 'Reconciliation completed',
      data: {
        summary,
        matched,
        missing,
        extra: extraBarcodes,
      },
    });
  } catch (error) {
    console.error('Reconciliation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

/**
 * Get all products for reconciliation dropdown
 */
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const { search = '' } = req.query;

    // Build query to get all products with their stocked-in barcode count
    // Use subquery to avoid GROUP BY issues and ensure all products are returned
    let query = `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.stock_quantity,
        COALESCE(
          (SELECT COUNT(*) 
           FROM barcodes b 
           WHERE b.product_id = p.id 
           AND b.is_stocked_in = TRUE), 
          0
        ) as stocked_in_barcodes_count
      FROM products p
      WHERE 1=1
    `;

    const params = [];

    // No status filter - show all products for reconciliation
    // Users may need to reconcile products regardless of status

    if (search) {
      query += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY p.name ASC';
    
    // Only apply limit if there's a search term (for performance)
    // When no search, fetch all products for dropdown
    if (search) {
      query += ' LIMIT 1000'; // Limit search results
    } else {
      query += ' LIMIT 10000'; // Very high limit for all products (should cover most use cases)
    }

    const [products] = await pool.execute(query, params);
    
    console.log(`[RECONCILIATION] Fetched ${products.length} products${search ? ` (search: "${search}")` : ' (all products)'}`);

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error('Get products for reconciliation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

module.exports = router;


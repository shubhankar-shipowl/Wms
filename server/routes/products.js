const express = require('express');
const Joi = require('joi');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs-extra');
const { pool, getTableName } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const cache = require('../config/cache');
const {
  upload,
  processImages,
  saveImagesToDatabase,
  getImagesFromDatabase,
  deleteImagesFromDatabase,
  getImageData,
  cleanupOldImages,
} = require('../middleware/upload');

const router = express.Router();

// Simple test endpoint to check database connection
router.get('/test-db', authenticateToken, async (req, res) => {
  try {
    const [count] = await pool.execute(
      'SELECT COUNT(*) as count FROM products',
    );
    const [products] = await pool.execute(
      'SELECT id, name, sku FROM products LIMIT 5',
    );

    res.json({
      success: true,
      data: {
        totalProducts: count[0].count,
        sampleProducts: products,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Validation schemas
const productSchema = Joi.object({
  name: Joi.string().required(),
  sku: Joi.string().required(),
  price: Joi.number().positive().required(),
  category: Joi.string().allow(''),
  unit: Joi.string().allow(''),
  status: Joi.string()
    .valid('active', 'inactive', 'discontinued')
    .default('active'),
  product_type: Joi.string()
    .valid('domestic', 'international')
    .default('domestic'),
  hsn_code: Joi.string().min(4).max(20).required().messages({
    'string.min': 'HSN code must be at least 4 characters',
    'string.max': 'HSN code must not exceed 20 characters',
    'any.required': 'HSN code is required',
  }),
  gst_rate: Joi.number().min(0).max(100).precision(2).required().messages({
    'number.min': 'GST rate must be at least 0%',
    'number.max': 'GST rate must not exceed 100%',
    'any.required': 'GST rate is required',
  }),
  rack: Joi.string().allow('').max(50),
  zone: Joi.string().valid('', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J').allow(''),
});

const updateProductSchema = Joi.object({
  name: Joi.string(),
  sku: Joi.string(),
  price: Joi.number().positive(),
  category: Joi.string().allow(''),
  unit: Joi.string().allow(''),
  status: Joi.string().valid('active', 'inactive', 'discontinued'),
  product_type: Joi.string().valid('domestic', 'international'),
  low_stock_threshold: Joi.number().integer().min(0),
  stock_quantity: Joi.number().integer().min(0),
  hsn_code: Joi.string().min(4).max(20).messages({
    'string.min': 'HSN code must be at least 4 characters',
    'string.max': 'HSN code must not exceed 20 characters',
  }),
  gst_rate: Joi.number().min(0).max(100).precision(2).messages({
    'number.min': 'GST rate must be at least 0%',
    'number.max': 'GST rate must not exceed 100%',
  }),
  rack: Joi.string().allow('').max(50),
  zone: Joi.string().valid('', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J').allow(''),
  images: Joi.array().items(Joi.string()).allow(null),
});

// Export products to CSV (Admin only)
router.get('/export/csv', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { search, category } = req.query;

    const params = [];
    const conditions = [];

    let query = `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        p.category,
        p.product_type,
        p.hsn_code,
        p.gst_rate,
        p.rack,
        p.created_at,
        p.updated_at
      FROM products p
    `;

    if (search) {
      conditions.push('(p.name LIKE ? OR p.sku LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY p.sku ASC';

    const [products] = await pool.execute(query, params);

    // Generate CSV content
    const csvHeader = [
      'ID',
      'Product Name',
      'SKU',
      'Price (₹)',
      'Category',
      'Product Type',
      'HSN Code',
      'GST Rate (%)',
      'Rack',
      'Created At',
      'Updated At',
    ].join(',');

    const csvRows = products.map((product) => {
      const formatDate = (date) => {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      };

      return [
        product.id,
        `"${(product.name || '').replace(/"/g, '""')}"`,
        `"${(product.sku || '').replace(/"/g, '""')}"`,
        product.price || 0,
        `"${(product.category || '').replace(/"/g, '""')}"`,
        `"${(product.product_type || '').replace(/"/g, '""')}"`,
        `"${(product.hsn_code || '').replace(/"/g, '""')}"`,
        product.gst_rate || 0,
        `"${(product.rack || '').replace(/"/g, '""')}"`,
        `"${formatDate(product.created_at)}"`,
        `"${formatDate(product.updated_at)}"`,
      ].join(',');
    });

    const csvContent = [csvHeader, ...csvRows].join('\n');

    // Set headers for CSV download
    const filename = `products_export_${
      new Date().toISOString().split('T')[0]
    }.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Add BOM for Excel compatibility (prepend to content)
    const csvWithBOM = '\ufeff' + csvContent;
    
    // Send CSV response
    res.send(csvWithBOM);
  } catch (error) {
    console.error('Export products CSV error:', error);
    // If headers already sent, we can't send JSON
    if (res.headersSent) {
      return res.end();
    }
    res.status(500).json({
      success: false,
      message: 'Failed to export products to CSV',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get all unique categories
// Get next SKU (auto-increment)
router.get('/next-sku', authenticateToken, async (req, res) => {
  try {
    // Get the latest SKU from database
    const [result] = await pool.execute(
      'SELECT sku FROM products WHERE sku LIKE "BW%" ORDER BY sku DESC LIMIT 1'
    );

    let nextSku = 'BW00001'; // Default if no products exist

    if (result.length > 0) {
      const latestSku = result[0].sku;
      // Extract number from SKU (e.g., "BW00035" -> 35)
      const match = latestSku.match(/BW(\d+)/);
      if (match) {
        const number = parseInt(match[1], 10);
        const nextNumber = number + 1;
        // Format with leading zeros (5 digits)
        nextSku = `BW${nextNumber.toString().padStart(5, '0')}`;
      }
    }

    res.json({
      success: true,
      data: { nextSku },
    });
  } catch (error) {
    console.error('Get next SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const [categories] = await pool.execute(
      `SELECT DISTINCT category 
       FROM products 
       WHERE category IS NOT NULL AND category != '' 
       ORDER BY category ASC`
    );

    const categoryList = categories.map((row) => row.category);

    res.json({
      success: true,
      data: categoryList,
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Get all products with stock information
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      category = '',
      sortBy = 'name',
      sortOrder = 'ASC',
    } = req.query;

    const pageNum = parseInt(page) || 1;
    // Support 'all' parameter to fetch all products without pagination
    const fetchAll = req.query.all === 'true' || req.query.all === true;
    const limitNum = fetchAll ? 999999 : (parseInt(limit) || 10);
    const offset = fetchAll ? 0 : (pageNum - 1) * limitNum;

    let query = `
      SELECT 
        p.*,
        p.stock_quantity as total_stock,
        COALESCE(bc.barcode_count, 0) as barcode_count
      FROM products p
      LEFT JOIN (
        SELECT 
          product_id,
          COUNT(*) as barcode_count 
        FROM barcodes 
        GROUP BY product_id
      ) bc ON p.id = bc.product_id
    `;

    const params = [];
    const conditions = [];

    // When fetching all products, don't apply search or category filters
    // This ensures we get ALL products for dropdowns
    if (!fetchAll) {
    if (search) {
      conditions.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
      }

      if (category) {
        conditions.push('p.category = ?');
        params.push(category);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Add sorting
    const validSortColumns = [
      'name',
      'sku',
      'price',
      'created_at',
      'total_stock',
    ];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'name';
    const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortColumn} ${order}`;

    // Add pagination (skip if fetching all)
    if (!fetchAll) {
    query += ` LIMIT ${limitNum} OFFSET ${offset}`;
    }

    const [result] = await pool.execute(query, params);

    // Get image information for each product
    const productsWithImages = await Promise.all(
      result.map(async (product) => {
        const imageIds = product.images ? JSON.parse(product.images) : [];
        const images =
          imageIds.length > 0 ? await getImagesFromDatabase(product.id) : [];

        return {
          ...product,
          images: images,
        };
      }),
    );

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM products p
    `;
    const countParams = [];

    // When fetching all, don't apply filters to count query either
    if (!fetchAll && (search || category)) {
      const countConditions = [];
    if (search) {
        countConditions.push('(p.name LIKE ? OR p.sku LIKE ?)');
        countParams.push(`%${search}%`, `%${search}%`);
      }
      if (category) {
        countConditions.push('p.category = ?');
        countParams.push(category);
      }
      countQuery += ` WHERE ${countConditions.join(' AND ')}`;
    }

    const [countResult] = await pool.execute(countQuery, countParams);

    const total = parseInt(countResult[0].total);
    const totalPages = fetchAll ? 1 : Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        products: productsWithImages,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalItems: total,
          itemsPerPage: limitNum,
        },
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Get single product with details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const productQuery = `
      SELECT 
        p.*,
        p.stock_quantity as current_stock,
        COALESCE(bc.barcode_count, 0) as barcode_count
      FROM products p
      LEFT JOIN (
        SELECT 
          product_id, 
          COUNT(*) as barcode_count 
         FROM barcodes 
         WHERE product_id = ?
        GROUP BY product_id
      ) bc ON p.id = bc.product_id
      WHERE p.id = ?
    `;

    const [productResult] = await pool.execute(productQuery, [id, id]);

    if (productResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Get barcodes for this product
    const barcodesQuery = `
      SELECT 
        b.*,
        p.stock_quantity as current_stock
       FROM barcodes b
       LEFT JOIN products p ON b.product_id = p.id
      WHERE b.product_id = ?
      ORDER BY b.created_at DESC
    `;

    const [barcodesResult] = await pool.execute(barcodesQuery, [id]);

    // Get recent transactions
    const transactionsQuery = `
      SELECT 
        t.*,
        u.username as created_by_username
       FROM transactions t
       LEFT JOIN users u ON t.user_id = u.id
      WHERE t.product_id = ?
      ORDER BY t.created_at DESC
      LIMIT 10
    `;

    const [transactionsResult] = await pool.execute(transactionsQuery, [id]);

    const product = productResult[0];

    // Get image information
    const imageIds = product.images ? JSON.parse(product.images) : [];
    const images = imageIds.length > 0 ? await getImagesFromDatabase(id) : [];

    product.images = images;
    product.barcodes = barcodesResult;
    product.recent_transactions = transactionsResult;

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Create new product with image upload (All authenticated users)
router.post(
  '/',
  authenticateToken,
  (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        console.error('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message:
              'Image file too large. Maximum size allowed is 2MB per file.',
          });
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            message: 'Too many files. Maximum 4 images allowed per product.',
          });
        } else if (err.message.includes('Invalid file format')) {
          return res.status(400).json({
            success: false,
            message: err.message,
          });
        } else {
          return res.status(400).json({
            success: false,
            message: 'Image upload error: ' + err.message,
          });
        }
      }
      next();
    });
  },
  (req, res, next) => {
    processImages(req, res, (err) => {
      if (err) {
        console.error('Image processing error:', err);
        return res.status(400).json({
          success: false,
          message:
            err.message ||
            'Failed to process images. Please check your image files.',
        });
      }
      next();
    });
  },
  async (req, res) => {
    // Set timeout for the request
    let requestCompleted = false;
    const timeout = setTimeout(() => {
      if (!requestCompleted && !res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Request timeout - product creation is taking too long',
        });
      }
    }, 15000); // 15 second timeout

    let connection;
    try {
      console.log('Starting product creation...');
      const startTime = Date.now();

      connection = await pool.getConnection();
      await connection.beginTransaction();

      const { error } = productSchema.validate(req.body);
      if (error) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      const {
        name,
        sku,
        price,
        category = '',
        unit = 'pcs',
        status = 'active',
        product_type = 'domestic',
        hsn_code,
        gst_rate,
        rack = '',
        zone = '',
      } = req.body;

      // Check if SKU already exists
      const [existingProduct] = await connection.execute(
        `SELECT id FROM products WHERE sku = ?`,
        [sku],
      );

      if (existingProduct.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'SKU already exists',
        });
      }

      // Create product first
      const [result] = await connection.execute(
        `INSERT INTO products (name, sku, price, category, unit, status, product_type, hsn_code, gst_rate, rack, zone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          name,
          sku,
          price,
          category,
          unit,
          status,
          product_type,
          hsn_code,
          gst_rate,
          rack,
          zone,
        ],
      );

      const productId = result.insertId;

      // Commit the product creation first (without images)
      await connection.commit();
      console.log('Product created successfully, now saving images...');

      // Save images to database if any (outside of transaction to avoid locks)
      let imageIds = [];
      if (req.processedImages && req.processedImages.length > 0) {
        console.log(
          `Saving ${req.processedImages.length} processed images to database...`,
        );
        try {
          imageIds = await saveImagesToDatabase(productId, req.processedImages);
          console.log(
            `Successfully saved images with IDs: ${imageIds.join(', ')}`,
          );
        } catch (imageError) {
          console.error('Error saving images to database:', imageError);
          // Don't fail the entire product creation if image saving fails
          // Just log the error and continue
        }

        // Update product with image references (new connection for this operation)
        const updateConnection = await pool.getConnection();
        try {
          await updateConnection.execute(
            `UPDATE products SET images = ? WHERE id = ?`,
            [JSON.stringify(imageIds), productId],
          );
          console.log('Product updated with image references');
        } finally {
          updateConnection.release();
        }
      } else {
        console.log('No images to save');
      }

      // Get the created product
      const [productRows] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [productId],
      );
      const product = productRows[0];

      // Note: Inventory management is handled separately through the inventory routes

      const totalTime = Date.now() - startTime;
      console.log(`Product creation completed in ${totalTime}ms`);

      // Clear timeout since request completed successfully
      clearTimeout(timeout);
      requestCompleted = true;

      // Emit real-time update
      req.io.emit('product_created', product);

      // Invalidate dashboard cache
      try {
        await cache.delPattern('dashboard:*');
      } catch (cacheError) {
        console.warn('Cache invalidation error:', cacheError);
      }

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product },
      });
    } catch (error) {
      clearTimeout(timeout);
      requestCompleted = true;

      // Only rollback if we haven't committed yet
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
      }
      console.error('Create product error:', error);

      // Check if response was already sent
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

// Update product (Admin only)
router.put(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        console.error('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message:
              'Image file too large. Maximum size allowed is 2MB per file.',
          });
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            message: 'Too many files. Maximum 4 images allowed per product.',
          });
        } else if (err.message.includes('Invalid file format')) {
          return res.status(400).json({
            success: false,
            message: err.message,
          });
        } else {
          return res.status(400).json({
            success: false,
            message: 'Image upload error: ' + err.message,
          });
        }
      }
      next();
    });
  },
  (req, res, next) => {
    processImages(req, res, (err) => {
      if (err) {
        console.error('Image processing error:', err);
        return res.status(400).json({
          success: false,
          message:
            err.message ||
            'Failed to process images. Please check your image files.',
        });
      }
      next();
    });
  },
  async (req, res) => {
    let connection;
    try {
      const { id } = req.params;
      
      // Handle existing image IDs from a separate field to avoid conflict with multer
      // Remove it from body before validation since it's not part of the schema
      let existingImageIds = null;
      if (req.body.existingImageIds) {
        try {
          existingImageIds = typeof req.body.existingImageIds === 'string' 
            ? JSON.parse(req.body.existingImageIds)
            : req.body.existingImageIds;
        } catch (parseError) {
          existingImageIds = [];
        }
        delete req.body.existingImageIds; // Remove from body before validation
      }
      
      // Remove images from body if it exists (will be handled separately)
      delete req.body.images;
      
      const { error } = updateProductSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Check if product exists
      const [existingProduct] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      if (existingProduct.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      // Check SKU uniqueness if SKU is being updated
      if (req.body.sku && req.body.sku !== existingProduct[0].sku) {
        const [skuCheck] = await connection.execute(
          `SELECT id FROM products WHERE sku = ? AND id != ?`,
          [req.body.sku, id],
        );

        if (skuCheck.length > 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            message: 'SKU already exists',
          });
        }
      }

      // Handle image uploads
      let imageIds = [];
      if (req.processedImages && req.processedImages.length > 0) {
        // If new images are uploaded, replace existing ones
        imageIds = await saveImagesToDatabase(id, req.processedImages);

        // Clean up old images
        const currentProduct = existingProduct[0];
        if (currentProduct.images) {
          const oldImageIds = JSON.parse(currentProduct.images);
          await cleanupOldImages(oldImageIds);
        }
      } else if (existingImageIds !== null) {
        // If existing image IDs are provided (for keeping existing images)
        imageIds = Array.isArray(existingImageIds)
          ? existingImageIds.map((imgId) => parseInt(imgId)).filter((id) => !isNaN(id))
          : [];
      } else {
        // Keep existing images if no new ones provided and no explicit IDs sent
        const currentProduct = existingProduct[0];
        if (currentProduct.images) {
          imageIds = JSON.parse(currentProduct.images);
        }
      }

      // Build update query dynamically
      const updateFields = [];
      const values = [];

      Object.keys(req.body).forEach((key) => {
        if (req.body[key] !== undefined && key !== 'images') {
          updateFields.push(`${key} = ?`);
          values.push(req.body[key]);
        }
      });

      // Always update images
      updateFields.push('images = ?');
      values.push(JSON.stringify(imageIds));

      if (updateFields.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      values.push(id);

      const query = `
        UPDATE products 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = ?
      `;

      await connection.execute(query, values);

      // Get updated product
      const [updatedProduct] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      await connection.commit();

      // Emit real-time update
      req.io.emit('product_updated', updatedProduct[0]);

      // Invalidate dashboard cache
      try {
        await cache.delPattern('dashboard:*');
      } catch (cacheError) {
        console.warn('Cache invalidation error:', cacheError);
      }

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product: updatedProduct[0] },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Update product error:', error);
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

// Update stock for a product
router.post(
  '/:id/update-stock',
  authenticateToken,
  requireRole(['admin', 'user']),
  async (req, res) => {
    let connection;
    try {
      const { id } = req.params;
      const { type, quantity, notes = '' } = req.body;

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Validate input
      if (!['in', 'out'].includes(type)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: "Transaction type must be 'in' or 'out'",
        });
      }

      if (!quantity || quantity <= 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'Quantity must be a positive number',
        });
      }

      // Get product details
      const [productResult] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      if (productResult.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      const product = productResult[0];

      // Get current inventory
      const [inventoryResult] = await connection.execute(
        'SELECT quantity FROM inventory WHERE product_id = ?',
        [id],
      );

      const currentStock =
        inventoryResult.length > 0 ? inventoryResult[0].quantity : 0;

      // For OUT transactions, check if sufficient stock is available
      if (type === 'out' && currentStock < quantity) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
        });
      }

      // Calculate new stock
      const newStock =
        type === 'in' ? currentStock + quantity : currentStock - quantity;

      // Create transaction
      const [transactionResult] = await connection.execute(
        `INSERT INTO transactions (product_id, type, quantity, reference_number, notes, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, type, quantity, `MANUAL_${Date.now()}`, notes, req.user.id],
      );

      // Update or create inventory record
      if (inventoryResult.length > 0) {
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_updated = NOW() WHERE product_id = ?',
          [newStock, id],
        );
      } else {
        await connection.execute(
          'INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, NOW())',
          [id, newStock],
        );
      }

      // Update product stock_quantity
      await connection.execute(
        'UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?',
        [newStock, id],
      );

      await connection.commit();

      // Emit real-time updates
      req.io.emit('transaction_created', {
        transaction: {
          ...transactionResult,
          product_name: product.name,
          product_sku: product.sku,
        },
      });

      req.io.emit('stock_updated', {
        product_id: parseInt(id),
        current_stock: newStock,
        product_name: product.name,
        sku: product.sku,
      });

      res.json({
        success: true,
        message: 'Stock updated successfully',
        data: {
          transaction: transactionResult,
          updated_stock: newStock,
        },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Update stock error:', error);
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

// Generate product barcode PDF
router.get('/:id/barcode-pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { copies = 1 } = req.query;

    // Get product and its barcodes
    const [productResult] = await pool.execute(
      'SELECT * FROM products WHERE id = ?',
      [id],
    );

    if (productResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const product = productResult[0];

    const [barcodesResult] = await pool.execute(
      'SELECT * FROM barcodes WHERE product_id = ?',
      [id],
    );

    if (barcodesResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No barcodes found for this product',
      });
    }

    // Create PDF
    const doc = new PDFDocument({ size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="product_${product.sku}_barcodes.pdf"`,
    );

    doc.pipe(res);

    // Add barcodes to PDF
    barcodesResult.forEach((barcode, index) => {
      if (index > 0) {
        doc.addPage();
      }

      doc.fontSize(16).text(product.name, 50, 50);
      doc.fontSize(12).text(`SKU: ${product.sku}`, 50, 80);
      doc.fontSize(12).text(`Barcode: ${barcode.barcode}`, 50, 100);
      doc.fontSize(12).text(`Price: ₹${product.price}`, 50, 120);
    });

    doc.end();
  } catch (error) {
    console.error('Generate barcode PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Delete product
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

      // Check if product exists
      const [existingProduct] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id],
      );

      if (existingProduct.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'Product not found',
        });
      }

      // Check if product has any transactions
      const [transactionCount] = await connection.execute(
        'SELECT COUNT(*) as count FROM transactions WHERE product_id = ?',
        [id],
      );

      if (parseInt(transactionCount[0].count) > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'Cannot delete product with existing transactions',
        });
      }

      // Clean up product images from database
      const product = existingProduct[0];
      if (product.images && product.images.length > 0) {
        const imageIds = JSON.parse(product.images);
        await cleanupOldImages(imageIds);
      }

      // Delete related records first
      await connection.execute('DELETE FROM barcodes WHERE product_id = ?', [
        id,
      ]);
      await connection.execute('DELETE FROM inventory WHERE product_id = ?', [
        id,
      ]);
      await connection.execute('DELETE FROM products WHERE id = ?', [id]);

      await connection.commit();

      // Emit real-time update
      req.io.emit('product_deleted', { id: parseInt(id) });

      // Invalidate dashboard cache
      try {
        await cache.delPattern('dashboard:*');
      } catch (cacheError) {
        console.warn('Cache invalidation error:', cacheError);
      }

      res.json({
        success: true,
        message: 'Product deleted successfully',
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Delete product error:', error);
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

// Serve product images from database
router.get('/images/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const { type = 'full' } = req.query; // 'full' or 'thumbnail'

    const imageData = await getImageData(parseInt(imageId), type);

    if (!imageData) {
      return res.status(404).json({
        success: false,
        message: 'Image not found',
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', imageData.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Send the image data
    res.send(imageData.data);
  } catch (error) {
    console.error('Serve image error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// Get product images metadata
router.get('/:id/images', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const [productResult] = await pool.execute(
      'SELECT id FROM products WHERE id = ?',
      [id],
    );

    if (productResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const images = await getImagesFromDatabase(id);

    res.json({
      success: true,
      data: images,
    });
  } catch (error) {
    console.error('Get product images error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

module.exports = router;

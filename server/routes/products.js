const express = require('express');
const Joi = require('joi');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs-extra');
const { pool, getTableName } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
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
  images: Joi.array().items(Joi.string()).allow(null),
});

// Get all products with stock information
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'name',
      sortOrder = 'ASC',
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

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

    if (search) {
      conditions.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
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

    // Add pagination
    query += ` LIMIT ${limitNum} OFFSET ${offset}`;

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

    if (search) {
      countQuery += ` WHERE (p.name LIKE ? OR p.sku LIKE ?)`;
    }

    const [countResult] = await pool.execute(
      countQuery,
      search ? [`%${search}%`, `%${search}%`] : [],
    );

    const total = parseInt(countResult[0].total);
    const totalPages = Math.ceil(total / limitNum);

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

// Create new product with image upload
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'user']),
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
      } = req.body;

      // Check if SKU already exists
      const [existingProduct] = await connection.execute(
        `SELECT id FROM products WHERE sku = ?`,
        [sku],
      );

      if (existingProduct.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'SKU already exists',
        });
      }

      // Create product first
      const [result] = await connection.execute(
        `INSERT INTO products (name, sku, price, category, unit, status, product_type, hsn_code, gst_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
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

// Update product
router.put(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'user']),
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
      } else if (req.body.images) {
        // If image IDs are provided in request body (for keeping existing images)
        let imagesData = req.body.images;

        // Handle both JSON string and array formats
        if (typeof imagesData === 'string') {
          try {
            imagesData = JSON.parse(imagesData);
          } catch (error) {
            console.error('Error parsing images JSON:', error);
            imagesData = [];
          }
        }

        imageIds = Array.isArray(imagesData)
          ? imagesData.map((id) => parseInt(id))
          : [parseInt(imagesData)];
      } else {
        // Keep existing images if no new ones provided
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
        return res.status(400).json({
          success: false,
          message: "Transaction type must be 'in' or 'out'",
        });
      }

      if (!quantity || quantity <= 0) {
        await connection.rollback();
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

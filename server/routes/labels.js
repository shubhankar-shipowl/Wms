const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { splitPdfIntoPages } = require('../services/pdfSplitter');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/labels');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `label-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

router.get('/hierarchy', authenticateToken, async (req, res) => {
  try {
    const { courier, product, search, startDate, endDate } = req.query;
    
    let query = `
      SELECT id, store_name, courier_name, product_name, order_number, customer_name,
             label_date, pdf_file_url, pdf_filename, upload_date
      FROM labels
      WHERE 1=1
    `;
    const params = [];

    if (courier) {
      query += ` AND courier_name = ?`;
      params.push(courier);
    }
    if (product) {
      query += ` AND product_name = ?`;
      params.push(product);
    }
    if (search) {
      query += ` AND product_name LIKE ?`;
      params.push(`%${search}%`);
    }
    if (startDate && endDate) {
      query += ` AND upload_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY courier_name, product_name`;

    const [rows] = await pool.execute(query, params);

    // Transform flat list into hierarchy (Courier -> Products)
    const couriersMap = new Map();
    const couriers = [];

    rows.forEach(row => {
      // Courier Level
      if (!couriersMap.has(row.courier_name)) {
        couriersMap.set(row.courier_name, {
          courier_name: row.courier_name,
          products_count: 0,
          products: []
        });
        couriers.push(couriersMap.get(row.courier_name));
      }
      const courierObj = couriersMap.get(row.courier_name);
      courierObj.products_count++;

      // Product Level
      courierObj.products.push({
        id: row.id,
        product_name: row.product_name,
        order_number: row.order_number,
        date: row.label_date || row.upload_date,
        pdf_url: row.pdf_file_url,
        filename: row.pdf_filename,
        store_name: row.store_name,
        customer_name: row.customer_name || ''
      });
    });

    res.json({ success: true, couriers: couriers });

  } catch (error) {
    console.error('Error fetching hierarchy:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch layout' });
  }
});

/**
 * GET /stats
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const [courierStats] = await pool.execute(`
      SELECT courier_name, COUNT(DISTINCT label_id) as count FROM labels GROUP BY courier_name ORDER BY count DESC LIMIT 5
    `);

    const [productStats] = await pool.execute(`
      SELECT product_name, COUNT(*) as count FROM labels GROUP BY product_name ORDER BY count DESC LIMIT 50
    `);

    const [totalStats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT courier_name) as total_couriers,
        COUNT(DISTINCT label_id) as total_labels
      FROM labels
    `);

    res.json({
      success: true,
      data: {
        total_couriers: totalStats[0].total_couriers,
        total_products: totalStats[0].total_labels,
        couriers_breakdown: courierStats,
        products_breakdown: productStats
      }
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Stats failed' });
  }
});

/**
 * GET /products
 * Returns products filtered by courier with counts
 */
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const { courier } = req.query;
    
    let query = `
      SELECT product_name, COUNT(*) as count 
      FROM labels 
      WHERE 1=1
    `;
    const params = [];

    if (courier) {
      query += ` AND courier_name = ?`;
      params.push(courier);
    }

    query += ` GROUP BY product_name ORDER BY count DESC LIMIT 50`;

    const [products] = await pool.execute(query, params);

    res.json({
      success: true,
      products: products
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

/**
 * GET /couriers
 * Returns couriers with counts
 */
router.get('/couriers', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT courier_name, COUNT(*) as count 
      FROM labels 
      WHERE 1=1
    `;
    const params = [];

    query += ` GROUP BY courier_name ORDER BY count DESC LIMIT 20`;

    const [couriers] = await pool.execute(query, params);

    res.json({
      success: true,
      couriers: couriers
    });

  } catch (error) {
    console.error('Error fetching couriers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch couriers' });
  }
});

/**
 * GET /personalized-notes-data
 * Returns unique customer names and store names for personalized note generation
 */
router.get('/personalized-notes-data', authenticateToken, async (req, res) => {
  try {
    // Return each unique customer+store pair (one note per label, not per product)
    const [entries] = await pool.execute(`
      SELECT customer_name, store_name, MAX(upload_date) as upload_date
      FROM labels
      WHERE customer_name IS NOT NULL AND customer_name != ''
      GROUP BY customer_name, store_name
      ORDER BY upload_date DESC
    `);

    const [stores] = await pool.execute(`
      SELECT DISTINCT store_name
      FROM labels
      WHERE store_name IS NOT NULL AND store_name != '' AND store_name != 'Unknown Store'
      ORDER BY store_name ASC
    `);

    res.json({
      success: true,
      entries: entries.map(r => ({ customer_name: r.customer_name, store_name: r.store_name })),
      stores: stores.map(r => r.store_name)
    });
  } catch (error) {
    console.error('Error fetching personalized notes data:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
});

/**
 * POST /upload
 */
router.post('/upload', authenticateToken, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const processed = [];
    const failed = [];

    for (const file of req.files) {
      try {
        // Prepare split directory
        const splitDir = path.join(path.dirname(file.path), 'split-pages');
        if (!fs.existsSync(splitDir)) fs.mkdirSync(splitDir, { recursive: true });

        // Split and Extract (concurrency handled inside splitPdfIntoPages)
        const pages = await splitPdfIntoPages(file.path, splitDir);

        // --- Batch duplicate check: collect all order numbers at once ---
        const orderEntries = []; // { index, orderNumber, courier_name }
        const duplicateSet = new Set(); // indices to skip

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          const courier_name = page.metadata.courier_company || page.metadata.courier_name || 'Unknown Courier';
          const orderNumber = page.metadata.order_number || null;
          if (orderNumber) {
            orderEntries.push({ index: i, orderNumber, courier_name });
          }
        }

        if (orderEntries.length > 0) {
          // Build a single query: WHERE (order_number = ? AND courier_name = ?) OR ...
          const conditions = orderEntries.map(() => '(order_number = ? AND courier_name = ?)').join(' OR ');
          const params = [];
          orderEntries.forEach(e => { params.push(e.orderNumber, e.courier_name); });

          const [existingRows] = await pool.execute(
            `SELECT order_number, courier_name FROM labels WHERE ${conditions}`,
            params
          );

          const existingKeys = new Set(existingRows.map(r => `${r.order_number}||${r.courier_name}`));

          for (const entry of orderEntries) {
            if (existingKeys.has(`${entry.orderNumber}||${entry.courier_name}`)) {
              duplicateSet.add(entry.index);
              failed.push({
                file: pages[entry.index].filename || file.originalname,
                error: `Duplicate Label: Order/AWB ${entry.orderNumber} already exists.`
              });
            }
          }
        }

        // --- Batch insert: collect all rows, then insert in one query ---
        const insertRows = [];

        for (let i = 0; i < pages.length; i++) {
          if (duplicateSet.has(i)) continue; // Skip duplicates

          const page = pages[i];
          const store_name = page.metadata.brand_name || page.metadata.store_name || 'Unknown Store';
          const courier_name = page.metadata.courier_company || page.metadata.courier_name || 'Unknown Courier';
          const customer_name = page.metadata.customer_name || '';
          const products = page.metadata.products || [];
          const singleProductName = page.metadata.product_name || 'Unknown Product';
          const relativePath = path.relative(path.join(__dirname, '../../'), page.filePath);
          const labelId = `LABEL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
          const orderNumber = page.metadata.order_number || null;

          const productsToInsert = products.length > 0
            ? products
            : [{ product_name: singleProductName, quantity: 1, price: 0 }];

          for (const product of productsToInsert) {
            insertRows.push({
              labelId,
              store_name,
              courier_name,
              product_name: product.product_name || 'Unknown Product',
              sku: product.sku || '',
              quantity: product.quantity || 1,
              price: product.price || 0,
              relativePath,
              filename: page.filename,
              userId: req.user.id,
              orderNumber,
              customer_name
            });
          }
        }

        // Batch insert in chunks of 50 to avoid query size limits
        const BATCH_SIZE = 50;
        for (let b = 0; b < insertRows.length; b += BATCH_SIZE) {
          const batch = insertRows.slice(b, b + BATCH_SIZE);
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const values = [];
          batch.forEach(row => {
            values.push(
              row.labelId, row.store_name, row.courier_name, row.product_name,
              row.sku, row.quantity, row.price,
              row.relativePath, row.filename, row.userId, row.orderNumber, row.customer_name
            );
          });

          const [result] = await pool.execute(
            `INSERT INTO labels (
              label_id, store_name, courier_name, product_name,
              sku, quantity, price,
              pdf_file_url, pdf_filename, created_by, order_number, customer_name
            ) VALUES ${placeholders}`,
            values
          );

          // Map inserted IDs back to processed results
          const firstId = result.insertId;
          batch.forEach((row, idx) => {
            processed.push({
              id: firstId + idx,
              filename: row.filename,
              label_id: row.labelId,
              metadata: { store_name: row.store_name, courier_name: row.courier_name, product_name: row.product_name, order_number: row.orderNumber, customer_name: row.customer_name }
            });
          });
        }

      } catch (e) {
        console.error(`Error processing ${file.originalname}:`, e);
        failed.push({ file: file.originalname, error: e.message });
      } finally {
        // Clean up the original uploaded file to prevent directory clutter
        if (file.path && fs.existsSync(file.path)) {
            try {
                fs.unlinkSync(file.path);
            } catch (cleanupErr) {
                console.error('Failed to cleanup uploaded file:', cleanupErr);
            }
        }
      }
    }

    res.json({
      success: true,
      processed: processed.length,
      failed: failed,
      data: processed
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

/**
 * POST /download
 * Bulk download logic
 */
router.post('/download', authenticateToken, async (req, res) => {
  try {
    const { courier, ids, merge, startDate, endDate } = req.body;
    
    // Construct query
    let query = 'SELECT * FROM labels WHERE 1=1';
    const params = [];
    
    if (ids && ids.length > 0) {
      query += ` AND id IN (${ids.map(() => '?').join(',')})`;
      ids.forEach(id => params.push(id));
    } else {
      if (courier) { query += ' AND courier_name = ?'; params.push(courier); }
      
      if (startDate && endDate) {
        // Adjust endDate to end of day if it looks like just a date string
        const start = new Date(startDate).toISOString().slice(0, 19).replace('T', ' ');
        const end = new Date(endDate).toISOString().slice(0, 19).replace('T', ' ');
        
        query += ' AND upload_date BETWEEN ? AND ?';
        params.push(start, end);
      }
    }

    const [labels] = await pool.execute(query, params);
    
    if (labels.length === 0) {
      return res.status(404).json({ success: false, message: 'No labels found' });
    }

    // Prepare files
    // Prepare files with context-aware naming
    const fileEntries = labels.map(l => {
      let internalName;
      if (courier) {
        // If downloading for a specific courier, group by Courier/Filename
        internalName = `${l.courier_name}/${l.pdf_filename}`;
      } else {
        // Default: Courier/Filename
        internalName = `${l.courier_name}/${l.pdf_filename}`;
      }
      return {
        path: path.join(__dirname, '../../', l.pdf_file_url),
        name: internalName
      };
    }).filter(f => fs.existsSync(f.path));

    if (fileEntries.length === 0) {
      return res.status(404).json({ success: false, message: 'Files not found on disk' });
    }

    // If merge logic requested (merging multiple PDFs into one)
    if (merge) {
      const mergedPdf = await PDFDocument.create();
      
      for (const entry of fileEntries) {
        try {
          const pdfBytes = fs.readFileSync(entry.path);
          const pdf = await PDFDocument.load(pdfBytes);
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        } catch (e) {
          console.error(`Skipping corrupt PDF ${entry.name}`, e);
        }
      }
      
      const mergedBytes = await mergedPdf.save();
      
      // Generate filename
      const uniqueCouriers = [...new Set(labels.map(l => l.courier_name))];
      const courierPrefix = uniqueCouriers.length === 1 ? uniqueCouriers[0] : 'Multiple';
      const mergedFilename = `${courierPrefix}_merged-labels.pdf`.replace(/\s+/g, '-');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${mergedFilename}"`);
      return res.send(Buffer.from(mergedBytes));
    } 
    
    // Default: Zip archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Generate filename
    const uniqueCouriers = [...new Set(labels.map(l => l.courier_name))];
    const courierPrefix = uniqueCouriers.length === 1 ? uniqueCouriers[0] : 'Multiple';
    const zipFilename = `${courierPrefix}_labels.zip`.replace(/\s+/g, '-');
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    
    archive.pipe(res);
    
    fileEntries.forEach(entry => {
      archive.file(entry.path, { name: entry.name }); 
    });
    
    archive.finalize();

  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

/**
 * DELETE /:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT pdf_file_url FROM labels WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      deleteFileFromDisk(rows[0].pdf_file_url);
    }
    
    await pool.execute('DELETE FROM labels WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Deletion failed' });
  }
});

/**
 * DELETE / (Bulk Delete)
 * Deletes labels based on query filters (startDate, endDate)
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });
    }

    // Helper to format ISO date to MySQL DATETIME (YYYY-MM-DD HH:MM:SS)
    const toMySQLDate = (isoStr) => {
      return new Date(isoStr).toISOString().slice(0, 19).replace('T', ' ');
    };

    const sqlStartDate = toMySQLDate(startDate);
    const sqlEndDate = toMySQLDate(endDate);

    // 1. Get files to delete
    const [rows] = await pool.execute(
      'SELECT pdf_file_url FROM labels WHERE upload_date BETWEEN ? AND ?', 
      [sqlStartDate, sqlEndDate]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No labels found in this date range' });
    }

    // 2. Delete files from disk
    let deletedCount = 0;
    for (const row of rows) {
      if (deleteFileFromDisk(row.pdf_file_url)) {
          deletedCount++;
      }
    }

    // 3. Delete from DB
    await pool.execute(
      'DELETE FROM labels WHERE upload_date BETWEEN ? AND ?',
      [sqlStartDate, sqlEndDate]
    );

    res.json({ success: true, message: `Deleted ${rows.length} labels`, filesDeleted: deletedCount });

  } catch (error) {
    console.error('Bulk deletion failed:', error);
    res.status(500).json({ success: false, message: 'Bulk deletion failed' });
  }
});

/**
 * Helper to delete file from multiple potential locations
 */
function deleteFileFromDisk(relativePath) {
  if (!relativePath) return false;

  let deleted = false;
  
  const pathsToTry = [
    // 1. Project Root (Wms/uploads/...) - Best guess
    path.join(__dirname, '../../', relativePath),
    // 2. Server Root (Wms/server/uploads/...) - User request
    path.join(__dirname, '../', relativePath),
    // 3. CWD relative (Wms/uploads/...) - Fallback
    path.join(process.cwd(), relativePath)
  ];

  // Dedup paths
  const uniquePaths = [...new Set(pathsToTry)];

  for (const p of uniquePaths) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        console.log(`Deleted file: ${p}`);
        deleted = true;
      } catch (e) {
        console.error(`Failed to delete file at ${p}:`, e);
      }
    }
  }
  return deleted;
}

module.exports = router;

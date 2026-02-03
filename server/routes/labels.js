const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { splitPdfIntoPages, getPdfPageCount } = require('../services/pdfSplitter');
const { extractLabelMetadata } = require('../services/pdfExtractor');
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
      SELECT id, store_name, courier_name, product_name, order_number, label_date, 
             pdf_file_url, pdf_filename, upload_date
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
        store_name: row.store_name // Keep store_name in product details just in case, but not as grouping
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
 * POST /upload
 */
router.post('/upload', authenticateToken, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const processed = [];
    const failed = [];

    // Allow manual overrides from body (if uploading single file contexts)
    // For bulk upload, we rely on extraction
    
    for (const file of req.files) {
      try {
        const pageCount = await getPdfPageCount(file.path);
        
        // Prepare split directory
        const splitDir = path.join(path.dirname(file.path), 'split-pages');
        if (!fs.existsSync(splitDir)) fs.mkdirSync(splitDir, { recursive: true });

        // Split and Extract
        const pages = await splitPdfIntoPages(file.path, splitDir);

        for (const page of pages) {
          // Map new property names from pdfExtractor
          const store_name = page.metadata.brand_name || page.metadata.store_name || 'Unknown Store';
          const courier_name = page.metadata.courier_company || page.metadata.courier_name || 'Unknown Courier';
          
          // Get products array - if available, otherwise fall back to single product_name
          const products = page.metadata.products || [];
          const singleProductName = page.metadata.product_name || 'Unknown Product';
          
          const relativePath = path.relative(path.join(__dirname, '../../'), page.filePath);

          // Generate unique label_id for this label (shared across all products on same label)
          const labelId = `LABEL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
          
          const orderNumber = page.metadata.order_number || null;

          // DUPLICATE CHECK
          // Query DB to see if this order number + courier already exists
          if (orderNumber) {
            const [existing] = await pool.execute(
              'SELECT id FROM labels WHERE order_number = ? AND courier_name = ? LIMIT 1',
              [orderNumber, courier_name]
            );
            
            if (existing.length > 0) {
              // Mark as failed/duplicate
              failed.push({ 
                file: page.filename || file.originalname, 
                error: `Duplicate Label: Order/AWB ${orderNumber} already exists.` 
              });
              continue; // Skip insertion
            }
          }

          // Determine products to insert
          const productsToInsert = products.length > 0 
            ? products 
            : [{ product_name: singleProductName, quantity: 1, price: 0 }];

          // Insert each product as separate entry (same label_id groups them)
          for (const product of productsToInsert) {
            const [result] = await pool.execute(
              `INSERT INTO labels (
                label_id, store_name, courier_name, product_name, 
                sku, quantity, price,
                pdf_file_url, pdf_filename, created_by, order_number
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                labelId,
                store_name, 
                courier_name, 
                product.product_name || 'Unknown Product',
                product.sku || '',
                product.quantity || 1,
                product.price || 0,
                relativePath, 
                page.filename, 
                req.user.id,
                orderNumber // Save extracted Order/AWB
              ]
            );

            processed.push({
              id: result.insertId,
              filename: page.filename,
              label_id: labelId,
              metadata: { store_name, courier_name, product_name: product.product_name, order_number: orderNumber }
            });
          }
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

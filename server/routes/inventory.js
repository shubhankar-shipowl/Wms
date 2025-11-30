const express = require("express");
const { pool, getTableName } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Get real-time inventory overview
router.get("/overview", authenticateToken, async (req, res) => {
  try {
    // Get total products
    const [totalProductsResult] = await pool.execute(
      "SELECT COUNT(*) as count FROM products"
    );
    const totalProducts = parseInt(totalProductsResult[0].count);

    // Get total barcodes
    const [totalBarcodesResult] = await pool.execute(
      "SELECT COUNT(*) as count FROM barcodes"
    );
    const totalBarcodes = parseInt(totalBarcodesResult[0].count);

    // Get total stock value
    const [stockValueResult] = await pool.execute(`
      SELECT COALESCE(SUM(p.price * p.stock_quantity), 0) as total_value
      FROM products p
    `);
    const totalStockValue = parseFloat(stockValueResult[0].total_value);

    // Get low stock products count
    const [lowStockResult] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM products p
      WHERE p.stock_quantity <= p.low_stock_threshold
    `);
    const lowStockCount = parseInt(lowStockResult[0].count);

    // Get recent transactions count (last 24 hours)
    const [recentTransactionsResult] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM products
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const recentTransactions = parseInt(recentTransactionsResult[0].count);

    // Get stock movement trends (last 7 days)
    const [trendResult] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        type as transaction_type,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at), type
      ORDER BY date DESC
    `);

    res.json({
      success: true,
      data: {
        totalProducts,
        totalBarcodes,
        totalStockValue,
        lowStockCount,
        recentTransactions,
        trends: trendResult,
      },
    });
  } catch (error) {
    console.error("Get inventory overview error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get detailed inventory list
router.get("/", authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      low_stock_only = false,
      sortBy = "name",
      sortOrder = "ASC",
    } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];
    const conditions = [];

    if (search) {
      conditions.push("(p.name LIKE ? OR p.sku LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    if (low_stock_only === "true" || low_stock_only === true) {
      conditions.push("p.stock_quantity <= p.low_stock_threshold");
    }

    if (conditions.length > 0) {
      whereClause = "WHERE " + conditions.join(" AND ");
    }

    const [inventory] = await pool.execute(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        p.low_stock_threshold,
        p.stock_quantity as current_stock,
        0 as reserved_quantity,
        p.stock_quantity as available_quantity,
        CASE 
          WHEN p.stock_quantity = 0 THEN 'critical'
          WHEN p.stock_quantity <= p.low_stock_threshold THEN 'low'
          ELSE 'normal'
        END as stock_status,
        p.created_at,
        p.updated_at
      FROM products p
      ${whereClause}
      ORDER BY p.${sortBy} ${sortOrder}
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `,
      params
    );

    // Get total count
    const [countResult] = await pool.execute(
      `
      SELECT COUNT(*) as total
      FROM products p
      ${whereClause}
    `,
      params
    );

    res.json({
      success: true,
      data: {
        inventory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          pages: Math.ceil(countResult[0].total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get inventory error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Update stock quantity
router.put("/:productId/stock", authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, reserved_quantity = 0 } = req.body;

    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity cannot be negative",
      });
    }

    // Check if inventory record exists
    const [existing] = await pool.execute(
      "SELECT id FROM products WHERE product_id = ?",
      [productId]
    );

    if (existing.length > 0) {
      // Update existing record
      await pool.execute(
        "UPDATE products SET quantity = ?, reserved_quantity = ?, last_updated = NOW() WHERE product_id = ?",
        [quantity, reserved_quantity, productId]
      );
    } else {
      // Create new record
      await pool.execute(
        "INSERT INTO products (product_id, quantity, reserved_quantity, last_updated) VALUES (?, ?, ?, NOW())",
        [productId, quantity, reserved_quantity]
      );
    }

    // Update product stock_quantity
    await pool.execute(
      "UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ?",
      [quantity, productId]
    );

    res.json({
      success: true,
      message: "Stock updated successfully",
    });
  } catch (error) {
    console.error("Update stock error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get stock movement history
router.get("/:productId/movements", authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [movements] = await pool.execute(
      `
      SELECT 
        t.*,
        p.name as product_name,
        p.sku as product_sku,
        u.username as created_by_username
      FROM products t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN products u ON t.user_id = u.id
      WHERE t.product_id = ?
      ORDER BY t.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `,
      [productId]
    );

    // Get total count
    const [countResult] = await pool.execute(
      "SELECT COUNT(*) as total FROM products WHERE product_id = ?",
      [productId]
    );

    res.json({
      success: true,
      data: {
        movements,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult[0].total,
          pages: Math.ceil(countResult[0].total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get stock movements error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get inventory analytics
router.get("/analytics", authenticateToken, async (req, res) => {
  try {
    const { period = 30 } = req.query;

    // Get stock movement trends for the specified period
    const [trends] = await pool.execute(
      `
      SELECT 
        DATE(created_at) as date,
        type as transaction_type,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(created_at), type
      ORDER BY date DESC
    `,
      [parseInt(period)]
    );

    // Get top products by movement
    const [topProducts] = await pool.execute(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        p.stock_quantity,
        COALESCE(SUM(t.quantity), 0) as total_movement,
        COUNT(t.id) as transaction_count
      FROM products p
      LEFT JOIN transactions t ON p.id = t.product_id 
        AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY p.id, p.name, p.sku, p.price, p.stock_quantity
      ORDER BY total_movement DESC
      LIMIT 10
    `,
      [parseInt(period)]
    );

    // Get stock status distribution
    const [stockStatus] = await pool.execute(`
      SELECT 
        CASE 
          WHEN stock_quantity = 0 THEN 'out_of_stock'
          WHEN stock_quantity <= low_stock_threshold THEN 'low_stock'
          ELSE 'normal'
        END as status,
        COUNT(*) as count
      FROM products
      GROUP BY status
    `);

    res.json({
      success: true,
      data: {
        trends,
        topProducts,
        stockStatus,
        period: parseInt(period),
      },
    });
  } catch (error) {
    console.error("Get inventory analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;

const express = require("express");
const { pool, getTableName } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const cache = require("../config/cache");
const dbHealthCheck = require("../middleware/dbHealthCheck");
const { warehouseMonitor } = require("../middleware/warehouseMonitor");

const router = express.Router();

// Health check endpoint
router.get("/health", async (req, res) => {
  try {
    // Test database connection
    const [result] = await pool.execute("SELECT 1 as test");

    // Test cache connection
    const cacheStatus = cache.isAvailable();

    res.json({
      success: true,
      status: "healthy",
      database: "connected",
      cache: cacheStatus ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      success: false,
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Warehouse monitoring endpoint
router.get("/monitoring", authenticateToken, async (req, res) => {
  try {
    const status = await warehouseMonitor.getWarehouseStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Get monitoring data error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get monitoring data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Cache invalidation helper
const invalidateDashboardCache = async () => {
  try {
    await cache.delPattern("dashboard:*");
    console.log("Dashboard cache invalidated");
  } catch (error) {
    console.error("Cache invalidation error:", error);
  }
};

// Get comprehensive dashboard data
router.get("/", authenticateToken, dbHealthCheck, async (req, res) => {
  let connection;
  try {
    // Check cache first
    const cacheKey = "dashboard:main";
    let cachedData = null;

    try {
      cachedData = await cache.get(cacheKey);
    } catch (cacheError) {
      console.warn(
        "Cache error (continuing without cache):",
        cacheError.message
      );
    }

    if (cachedData && cache.isAvailable()) {
      console.log("Serving dashboard data from cache");
      return res.json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    console.log("Fetching dashboard data from database");

    // Get database connection
    connection = await pool.getConnection();

    // Key metrics
    const [metricsResult] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM barcodes) as total_barcodes,
        (SELECT COALESCE(SUM(p.price * p.stock_quantity), 0) 
         FROM products p) as total_inventory_value,
        (SELECT COUNT(*) FROM products WHERE stock_quantity <= 10) as active_alerts,
        (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURDATE()) as today_transactions
    `);

    // Stock movement trends (last 30 days)
    const [trendsResult] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        type as transaction_type,
        SUM(quantity) as total_quantity,
        COUNT(*) as transaction_count
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at), type
      ORDER BY date DESC
    `);

    // Top products by value
    const [topProductsByValueResult] = await pool.execute(`
      SELECT 
        p.name,
        p.sku,
        p.price,
        p.stock_quantity,
        p.stock_quantity * p.price as stock_value
      FROM products p
      WHERE p.stock_quantity > 0
      ORDER BY stock_value DESC
      LIMIT 10
    `);

    // Top products by movement (last 30 days) - simplified
    const [topProductsByMovementResult] = await pool.execute(`
      SELECT 
        p.name,
        p.sku,
        COUNT(t.id) as transaction_count,
        SUM(CASE WHEN t.type = 'in' THEN t.quantity ELSE 0 END) as total_in,
        SUM(CASE WHEN t.type = 'out' THEN t.quantity ELSE 0 END) as total_out,
        SUM(t.quantity) as total_movement
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      WHERE t.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY p.id, p.name, p.sku
      ORDER BY total_movement DESC
      LIMIT 10
    `);

    // Low stock products - simplified
    const [lowStockResult] = await pool.execute(`
      SELECT 
        p.name,
        p.sku,
        p.stock_quantity as low_stock_threshold,
        p.stock_quantity as current_stock,
        CASE 
          WHEN p.stock_quantity = 0 THEN 'critical'
          WHEN p.stock_quantity <= 5 THEN 'high'
          ELSE 'medium'
        END as severity
      FROM products p
      WHERE p.stock_quantity <= 10
      ORDER BY p.stock_quantity ASC
      LIMIT 10
    `);

    // Recent transactions - simplified
    const [recentTransactionsResult] = await pool.execute(`
      SELECT 
        t.*,
        p.name as product_name,
        p.sku as product_sku,
        u.username as created_by_username
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    // Monthly comparison - simplified
    const [monthlyComparisonResult] = await pool.execute(`
      SELECT 
        MONTH(created_at) as month,
        YEAR(created_at) as year,
        type as transaction_type,
        COUNT(*) as transaction_count,
        SUM(quantity) as total_quantity
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
      GROUP BY MONTH(created_at), YEAR(created_at), type
      ORDER BY year DESC, month DESC
    `);

    // Alert trends - simplified
    const [alertTrendsResult] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as alert_count
      FROM products
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    const dashboardData = {
      metrics: metricsResult[0],
      trends: trendsResult,
      topProductsByValue: topProductsByValueResult,
      topProductsByMovement: topProductsByMovementResult,
      lowStockProducts: lowStockResult,
      recentTransactions: recentTransactionsResult,
      monthlyComparison: monthlyComparisonResult,
      alertTrends: alertTrendsResult,
    };

    // Cache the result for 5 minutes
    try {
      await cache.set(cacheKey, dashboardData, 300);
    } catch (cacheError) {
      console.warn("Cache set error (continuing):", cacheError.message);
    }

    res.json({
      success: true,
      data: dashboardData,
      cached: false,
    });
  } catch (error) {
    console.error("Get dashboard data error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Get real-time metrics (for live updates)
router.get("/metrics/realtime", authenticateToken, async (req, res) => {
  try {
    // Check cache first for real-time metrics
    const cacheKey = "dashboard:realtime";
    let cachedData = null;

    try {
      cachedData = await cache.get(cacheKey);
    } catch (cacheError) {
      console.warn(
        "Realtime cache error (continuing without cache):",
        cacheError.message
      );
    }

    if (cachedData && cache.isAvailable()) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    const [result] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM barcodes) as total_barcodes,
        (SELECT COALESCE(SUM(stock_quantity), 0) 
         FROM products) as total_stock_units,
        (SELECT COALESCE(SUM(p.price * p.stock_quantity), 0) 
         FROM products p) as total_inventory_value,
        (SELECT COUNT(*) FROM products p WHERE p.stock_quantity <= p.low_stock_threshold) as active_alerts,
        (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURDATE()) as today_transactions,
        (SELECT COUNT(*) FROM transactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) as last_hour_transactions
    `);

    const metricsData = result[0];

    // Cache the real-time metrics for 30 seconds
    try {
      await cache.set(cacheKey, metricsData, 30);
    } catch (cacheError) {
      console.warn(
        "Realtime cache set error (continuing):",
        cacheError.message
      );
    }

    res.json({
      success: true,
      data: metricsData,
    });
  } catch (error) {
    console.error("Get realtime metrics error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get stock distribution analysis
router.get(
  "/analysis/stock-distribution",
  authenticateToken,
  async (req, res) => {
    try {
      // Stock distribution by value ranges
      const [distributionResult] = await pool.execute(`
      SELECT 
        CASE 
          WHEN stock_value = 0 THEN 'No Stock'
          WHEN stock_value <= 100 THEN '₹0-₹100'
          WHEN stock_value <= 500 THEN '₹100-₹500'
          WHEN stock_value <= 1000 THEN '₹500-₹1K'
          WHEN stock_value <= 5000 THEN '₹1K-₹5K'
          ELSE '₹5K+'
        END as value_range,
        COUNT(*) as product_count,
        SUM(stock_value) as total_value
      FROM (
        SELECT 
          p.id,
          p.name,
          p.sku,
          p.stock_quantity * p.price as stock_value
        FROM products p
      ) as stock_values
      GROUP BY 
        CASE 
          WHEN stock_value = 0 THEN 'No Stock'
          WHEN stock_value <= 100 THEN '₹0-₹100'
          WHEN stock_value <= 500 THEN '₹100-₹500'
          WHEN stock_value <= 1000 THEN '₹500-₹1K'
          WHEN stock_value <= 5000 THEN '₹1K-₹5K'
          ELSE '₹5K+'
        END
      ORDER BY 
        CASE 
          WHEN value_range = 'No Stock' THEN 0
          WHEN value_range = '₹0-₹100' THEN 1
          WHEN value_range = '₹100-₹500' THEN 2
          WHEN value_range = '₹500-₹1K' THEN 3
          WHEN value_range = '₹1K-₹5K' THEN 4
          ELSE 5
        END
    `);

      // Stock age analysis (based on last transaction)
      const [ageAnalysisResult] = await pool.execute(`
      SELECT 
        CASE 
          WHEN last_transaction_date IS NULL THEN 'Never Moved'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 'Last 7 days'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 'Last 30 days'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 'Last 90 days'
          ELSE 'Over 90 days'
        END as age_category,
        COUNT(*) as product_count,
        SUM(current_stock) as total_stock
      FROM (
        SELECT 
          p.id,
          p.name,
          p.sku,
          MAX(t.created_at) as last_transaction_date,
          p.stock_quantity as current_stock
        FROM products p
        LEFT JOIN products t ON p.id = t.product_id
        GROUP BY p.id, p.name, p.sku, p.stock_quantity
      ) as last_transactions
      GROUP BY 
        CASE 
          WHEN last_transaction_date IS NULL THEN 'Never Moved'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 'Last 7 days'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 'Last 30 days'
          WHEN last_transaction_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 'Last 90 days'
          ELSE 'Over 90 days'
        END
      ORDER BY 
        CASE 
          WHEN age_category = 'Last 7 days' THEN 1
          WHEN age_category = 'Last 30 days' THEN 2
          WHEN age_category = 'Last 90 days' THEN 3
          WHEN age_category = 'Over 90 days' THEN 4
          ELSE 5
        END
    `);

      res.json({
        success: true,
        data: {
          valueDistribution: distributionResult,
          ageAnalysis: ageAnalysisResult,
        },
      });
    } catch (error) {
      console.error("Get stock distribution analysis error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Get performance metrics
router.get("/performance", authenticateToken, async (req, res) => {
  try {
    const { period = "30" } = req.query; // days

    // Transaction velocity
    const [velocityResult] = await pool.execute(
      `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as transaction_count,
        SUM(quantity) as total_quantity,
        COUNT(DISTINCT product_id) as unique_products
      FROM products
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `
    );

    // User activity
    const [userActivityResult] = await pool.execute(
      `
      SELECT 
        u.username as created_by,
        COUNT(*) as transaction_count,
        SUM(quantity) as total_quantity,
        COUNT(DISTINCT product_id) as unique_products
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)
        AND t.user_id IS NOT NULL
      GROUP BY t.user_id, u.username
      ORDER BY transaction_count DESC
      LIMIT 10
    `
    );

    // Error rates (transactions that might indicate issues)
    const [errorAnalysisResult] = await pool.execute(
      `
      SELECT 
        COUNT(CASE WHEN type = 'OUT' AND quantity > 100 THEN 1 END) as large_outbound,
        COUNT(CASE WHEN type = 'IN' AND quantity > 500 THEN 1 END) as large_inbound,
        COUNT(CASE WHEN notes LIKE '%error%' OR notes LIKE '%mistake%' OR notes LIKE '%correction%' THEN 1 END) as potential_corrections
      FROM products
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)
    `
    );

    // System performance metrics
    const [systemMetricsResult] = await pool.execute(
      `
      SELECT 
        (SELECT COUNT(*) FROM products WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)) as new_products,
        (SELECT COUNT(*) FROM barcodes WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)) as new_barcodes,
        (SELECT COUNT(*) FROM alerts WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)) as new_alerts,
        (SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)) 
         FROM products 
         WHERE is_read = 1 
           AND created_at >= DATE_SUB(CURDATE(), INTERVAL ${period} DAY)) as avg_alert_resolution_hours
    `
    );

    res.json({
      success: true,
      data: {
        period: parseInt(period),
        velocity: velocityResult,
        userActivity: userActivityResult,
        errorAnalysis: errorAnalysisResult[0],
        systemMetrics: systemMetricsResult[0],
      },
    });
  } catch (error) {
    console.error("Get performance metrics error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get forecast data (simple trend-based forecasting)
router.get("/forecast", authenticateToken, async (req, res) => {
  try {
    const { product_id, days = "30" } = req.query;

    let query = `
      SELECT 
        pt.*,
        p.name,
        p.sku,
        p.stock_quantity as current_stock,
        p.stock_quantity as low_stock_threshold,
        CASE 
          WHEN pt.avg_daily_out > 0 THEN 
            p.stock_quantity / pt.avg_daily_out
          ELSE NULL
        END as days_until_stockout
      FROM (
        SELECT 
          product_id,
          AVG(daily_out) as avg_daily_out,
          AVG(daily_in) as avg_daily_in,
          STDDEV(daily_out) as stddev_out,
          COUNT(*) as data_points
        FROM (
          SELECT 
            DATE(created_at) as date,
            product_id,
            SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END) as daily_out,
            SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END) as daily_in
          FROM products
          WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    `;

    const params = [];
    if (product_id) {
      query += ` AND product_id = ?`;
      params.push(product_id);
    }

    query += `
          GROUP BY DATE(created_at), product_id
        ) as daily_movements
        GROUP BY product_id
        HAVING COUNT(*) >= 7
      ) as pt
      JOIN products p ON pt.product_id = p.id
      LEFT JOIN products b ON p.id = b.product_id
      GROUP BY pt.product_id, pt.avg_daily_out, pt.avg_daily_in, pt.stddev_out, pt.data_points, p.name, p.sku, p.stock_quantity
      ORDER BY days_until_stockout ASC
      LIMIT 20
    `;

    const [result] = await pool.execute(query, params);

    // Generate simple forecast for next N days
    const forecasts = result.map((row) => {
      const forecastDays = parseInt(days);
      const dailyForecast = [];

      for (let i = 1; i <= forecastDays; i++) {
        const projectedStock = Math.max(
          0,
          row.current_stock - row.avg_daily_out * i + row.avg_daily_in * i
        );

        dailyForecast.push({
          day: i,
          projected_stock: Math.round(projectedStock),
          will_be_low_stock: projectedStock <= row.low_stock_threshold,
          stockout_risk: projectedStock <= 0,
        });
      }

      return {
        ...row,
        forecast: dailyForecast,
      };
    });

    res.json({
      success: true,
      data: {
        forecasts,
        period: parseInt(days),
      },
    });
  } catch (error) {
    console.error("Get forecast data error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;

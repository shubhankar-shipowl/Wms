const express = require("express");
const Joi = require("joi");
const { pool, getTableName } = require("../config/database");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();

// Helper function to calculate average daily consumption and days until stockout
async function calculateForecast(productId, currentStock) {
  try {
    // Calculate total stock out in the last 90 days
    const [outResult] = await pool.execute(
      `
      SELECT 
        COALESCE(SUM(quantity), 0) as total_out,
        COUNT(DISTINCT DATE(created_at)) as days_with_transactions
      FROM transactions
      WHERE product_id = ?
        AND type = 'out'
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    `,
      [productId]
    );

    const totalOut = parseInt(outResult[0].total_out) || 0;
    const daysWithTransactions = parseInt(outResult[0].days_with_transactions) || 1; // Avoid division by zero

    // Calculate average daily consumption
    const avgDailyConsumption = totalOut / daysWithTransactions;

    // Calculate days until stockout (only if there's consumption and stock)
    let daysUntilStockout = null;
    if (avgDailyConsumption > 0 && currentStock > 0) {
      daysUntilStockout = currentStock / avgDailyConsumption;
    }

    return {
      avgDailyConsumption: parseFloat(avgDailyConsumption.toFixed(2)),
      daysUntilStockout: daysUntilStockout ? parseFloat(daysUntilStockout.toFixed(2)) : null,
    };
  } catch (error) {
    console.error(`Error calculating forecast for product ${productId}:`, error);
    return {
      avgDailyConsumption: 0,
      daysUntilStockout: null,
    };
  }
}

// Get low stock alerts (with forecast-based logic)
router.get("/low-stock", authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // First, get all products with their stock levels
    const [allProducts] = await pool.execute(
      `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        p.price as product_price,
        p.low_stock_threshold,
        p.stock_quantity as current_stock,
        p.updated_at as last_updated
      FROM products p
      WHERE p.stock_quantity >= 0
    `
    );

    // Calculate forecast for each product and filter alerts
    const alertsWithForecast = [];
    
    for (const product of allProducts) {
      const forecast = await calculateForecast(product.product_id, product.current_stock);
      
      // Only check forecast-based alert (will run out in 15 days or less)
      // Also alert if stock is 0 (critical case)
      let shouldAlert = false;
      let alertLevel = 'low';
      
      if (product.current_stock === 0) {
        // Critical: out of stock
        alertLevel = 'critical';
        shouldAlert = true;
      } else if (forecast.daysUntilStockout !== null && forecast.daysUntilStockout <= 15 && product.current_stock > 0) {
        // Forecast-based alert: will run out in 15 days or less
        shouldAlert = true;
        // Set critical if days until stockout is very low (3 days or less)
        if (forecast.daysUntilStockout <= 3) {
          alertLevel = 'critical';
        }
      }

      // Add to alerts if should alert
      if (shouldAlert) {
        alertsWithForecast.push({
          ...product,
          alert_level: alertLevel,
          alert_type: 'forecast',
          avg_daily_consumption: forecast.avgDailyConsumption,
          days_until_stockout: forecast.daysUntilStockout,
        });
      }
    }

    // Sort alerts by priority
    alertsWithForecast.sort((a, b) => {
      // Critical alerts first (stock = 0 or days until stockout <= 3)
      if (a.alert_level === 'critical' && b.alert_level !== 'critical') return -1;
      if (b.alert_level === 'critical' && a.alert_level !== 'critical') return 1;
      
      // Then by days until stockout (lower first)
      if (a.days_until_stockout !== null && b.days_until_stockout !== null) {
        return a.days_until_stockout - b.days_until_stockout;
      }
      if (a.days_until_stockout !== null) return -1;
      if (b.days_until_stockout !== null) return 1;
      
      // Finally by current stock (lower first)
      return a.current_stock - b.current_stock;
    });

    // Apply pagination
    const total = alertsWithForecast.length;
    const paginatedAlerts = alertsWithForecast.slice(offset, offset + parseInt(limit));

    res.json({
      success: true,
      data: {
        alerts: paginatedAlerts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get low stock alerts error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get alert summary (including forecast-based alerts)
router.get("/summary", authenticateToken, async (req, res) => {
  try {
    // Get all products
    const [allProducts] = await pool.execute(`
      SELECT 
        p.id,
        p.stock_quantity,
        p.low_stock_threshold
      FROM products p
      WHERE p.stock_quantity >= 0
    `);

    let criticalAlerts = 0;
    let forecastAlerts = 0;
    let normalStock = 0;

    // Check each product for alerts (forecast-based only)
    for (const product of allProducts) {
      const forecast = await calculateForecast(product.id, product.stock_quantity);
      
      let hasAlert = false;

      // Check forecast-based alerts
      if (product.stock_quantity === 0) {
        // Out of stock - critical
        criticalAlerts++;
        hasAlert = true;
      } else if (forecast.daysUntilStockout !== null && 
          forecast.daysUntilStockout <= 15 && 
          product.stock_quantity > 0) {
        // Will run out in 15 days or less
        if (forecast.daysUntilStockout <= 3) {
          criticalAlerts++;
        } else {
          forecastAlerts++;
        }
        hasAlert = true;
      }

      // Count normal stock
      if (!hasAlert) {
        normalStock++;
      }
    }

    res.json({
      success: true,
      data: {
        critical_alerts: criticalAlerts,
        forecast_alerts: forecastAlerts,
        normal_stock: normalStock,
        total_products: allProducts.length,
      },
    });
  } catch (error) {
    console.error("Get alert summary error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get recent alerts activity
router.get("/activity", authenticateToken, async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const [activity] = await pool.execute(
      `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as alert_count,
        COUNT(CASE WHEN type = 'in' THEN 1 END) as stock_in_count,
        COUNT(CASE WHEN type = 'out' THEN 1 END) as stock_out_count
      FROM products
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `,
      [parseInt(days)]
    );

    res.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error("Get alerts activity error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get products approaching low stock
router.get("/approaching-low-stock", authenticateToken, async (req, res) => {
  try {
    const { threshold = 0.5 } = req.query; // 50% of low stock threshold

    const [products] = await pool.execute(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        p.low_stock_threshold,
        COALESCE(i.quantity, 0) as current_stock,
        ROUND((COALESCE(i.quantity, 0) / p.low_stock_threshold) * 100, 2) as stock_percentage
      FROM products p
      LEFT JOIN products i ON p.id = i.product_id
      WHERE COALESCE(i.quantity, 0) > p.low_stock_threshold 
        AND COALESCE(i.quantity, 0) <= (p.low_stock_threshold * (1 + ?))
      ORDER BY stock_percentage ASC
    `,
      [parseFloat(threshold)]
    );

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Get approaching low stock error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get stock movement alerts (unusual activity)
router.get("/movement-alerts", authenticateToken, async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const [movements] = await pool.execute(
      `
      SELECT 
        p.name as product_name,
        p.sku as product_sku,
        t.type,
        t.quantity,
        t.reference_number,
        t.created_at,
        u.username as created_by
      FROM products t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN products u ON t.user_id = u.id
      WHERE t.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND (t.quantity > 100 OR t.notes LIKE '%urgent%' OR t.notes LIKE '%emergency%')
      ORDER BY t.created_at DESC
      LIMIT 20
    `,
      [parseInt(days)]
    );

    res.json({
      success: true,
      data: movements,
    });
  } catch (error) {
    console.error("Get movement alerts error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Manually trigger low stock check (including forecast-based alerts)
router.post("/check-low-stock", authenticateToken, async (req, res) => {
  try {
    // Get all products
    const [allProducts] = await pool.execute(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.stock_quantity,
        p.low_stock_threshold
      FROM products p
      WHERE p.stock_quantity >= 0
    `);

    const alertsFound = [];

    // Check each product for alerts (forecast-based only)
    for (const product of allProducts) {
      const forecast = await calculateForecast(product.id, product.stock_quantity);
      
      let alertLevel = null;
      let shouldAlert = false;

      // Check forecast-based alert (will run out in 15 days or less)
      // Also alert if stock is 0 (critical case)
      if (product.stock_quantity === 0) {
        // Critical: out of stock
        alertLevel = 'critical';
        shouldAlert = true;
      } else if (forecast.daysUntilStockout !== null && 
          forecast.daysUntilStockout <= 15 && 
          product.stock_quantity > 0) {
        // Forecast-based alert: will run out in 15 days or less
        shouldAlert = true;
        // Set critical if days until stockout is very low (3 days or less)
        if (forecast.daysUntilStockout <= 3) {
          alertLevel = 'critical';
        } else {
          alertLevel = 'low';
        }
      }

      if (shouldAlert) {
        alertsFound.push({
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          current_stock: product.stock_quantity,
          low_stock_threshold: product.low_stock_threshold,
          alert_level: alertLevel,
          alert_type: 'forecast',
          avg_daily_consumption: forecast.avgDailyConsumption,
          days_until_stockout: forecast.daysUntilStockout,
        });
      }
    }

    res.json({
      success: true,
      message: `Found ${alertsFound.length} products with low stock alerts`,
      data: {
        alerts_count: alertsFound.length,
        alerts: alertsFound,
      },
    });
  } catch (error) {
    console.error("Check low stock error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get system health alerts
router.get(
  "/system-health",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const alerts = [];

      // Check for products without inventory records
      const [noInventory] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM products p
      LEFT JOIN products i ON p.id = i.product_id
      WHERE i.id IS NULL
    `);

      if (noInventory[0].count > 0) {
        alerts.push({
          type: "warning",
          message: `${noInventory[0].count} products have no inventory records`,
          severity: "medium",
        });
      }

      // Check for products with negative stock
      const [negativeStock] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM products
      WHERE quantity < 0
    `);

      if (negativeStock[0].count > 0) {
        alerts.push({
          type: "error",
          message: `${negativeStock[0].count} products have negative stock`,
          severity: "high",
        });
      }

      // Check for old transactions (no activity in 30 days)
      const [oldTransactions] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM products
      WHERE created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

      if (oldTransactions[0].count > 0) {
        alerts.push({
          type: "info",
          message: `${oldTransactions[0].count} transactions older than 30 days`,
          severity: "low",
        });
      }

      res.json({
        success: true,
        data: alerts,
      });
    } catch (error) {
      console.error("Get system health alerts error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

module.exports = router;

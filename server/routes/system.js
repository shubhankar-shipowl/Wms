const express = require("express");
const pool = require("../config/database");
const cache = require("../config/cache");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { warehouseMonitor } = require("../middleware/warehouseMonitor");
const { runBackupNow } = require("../services/backupService");

const router = express.Router();

// System status endpoint
router.get("/status", authenticateToken, async (req, res) => {
  try {
    const startTime = Date.now();

    // Test database connection
    let dbStatus = "connected";
    let dbResponseTime = 0;
    try {
      const dbStart = Date.now();
      await pool.execute("SELECT 1 as test");
      dbResponseTime = Date.now() - dbStart;
    } catch (error) {
      dbStatus = "disconnected";
      console.error("Database connection test failed:", error);
    }

    // Test cache connection
    let cacheStatus = "disconnected";
    let cacheResponseTime = 0;
    try {
      const cacheStart = Date.now();
      if (cache.isAvailable()) {
        await cache.get("test_key");
        cacheStatus = "connected";
        cacheResponseTime = Date.now() - cacheStart;
      }
    } catch (error) {
      cacheStatus = "disconnected";
      console.error("Cache connection test failed:", error);
    }

    // Get system metrics
    const metrics = warehouseMonitor.getMetrics();
    const warehouseStatus = await warehouseMonitor.getWarehouseStatus();

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024),
    };

    // Get uptime
    const uptime = process.uptime();
    const uptimeFormatted = formatUptime(uptime * 1000);

    // Determine overall system health
    let overallStatus = "healthy";
    if (dbStatus !== "connected") overallStatus = "critical";
    else if (cacheStatus !== "connected" && metrics.criticalAlerts > 0)
      overallStatus = "warning";
    else if (metrics.successRate < 95) overallStatus = "degraded";

    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        overall: {
          status: overallStatus,
          timestamp: new Date().toISOString(),
          responseTime: responseTime,
        },
        database: {
          status: dbStatus,
          responseTime: dbResponseTime,
        },
        cache: {
          status: cacheStatus,
          responseTime: cacheResponseTime,
        },
        system: {
          uptime: uptime,
          uptimeFormatted: uptimeFormatted,
          memory: memoryUsageMB,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        warehouse: warehouseStatus,
        metrics: metrics,
      },
    });
  } catch (error) {
    console.error("System status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get system status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// System metrics endpoint
router.get(
  "/metrics",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const metrics = warehouseMonitor.getMetrics();

      res.json({
        success: true,
        data: {
          metrics: metrics,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("System metrics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get system metrics",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Database health check
router.get(
  "/database/health",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const startTime = Date.now();

      // Test basic connection
      await pool.execute("SELECT 1 as test");

      // Test complex query
      const [result] = await pool.execute(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN stock_quantity <= low_stock_threshold THEN 1 END) as low_stock_count
      FROM products
    `);

      const responseTime = Date.now() - startTime;

      res.json({
        success: true,
        data: {
          status: "healthy",
          responseTime: responseTime,
          totalProducts: result[0].total_products,
          lowStockCount: result[0].low_stock_count,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Database health check error:", error);
      res.status(500).json({
        success: false,
        message: "Database health check failed",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Cache health check
router.get(
  "/cache/health",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const startTime = Date.now();

      if (!cache.isAvailable()) {
        return res.json({
          success: true,
          data: {
            status: "unavailable",
            message: "Cache is not available",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Test cache operations
      const testKey = "health_check_" + Date.now();
      const testValue = { test: true, timestamp: new Date().toISOString() };

      await cache.set(testKey, testValue, 10);
      const retrieved = await cache.get(testKey);
      await cache.del(testKey);

      const responseTime = Date.now() - startTime;

      res.json({
        success: true,
        data: {
          status: "healthy",
          responseTime: responseTime,
          operations: {
            set: true,
            get: retrieved !== null,
            del: true,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Cache health check error:", error);
      res.status(500).json({
        success: false,
        message: "Cache health check failed",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Helper function to format uptime
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Manual database backup endpoint (admin only)
router.post(
  "/backup",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      console.log("[BACKUP] Manual backup triggered by user:", req.user.username);
      const result = await runBackupNow();

      if (result.success) {
        res.json({
          success: true,
          message: "Backup created successfully",
          data: {
            fileName: result.fileName,
            filePath: result.filePath,
            size: result.size,
            sizeMB: (result.size / 1024 / 1024).toFixed(2),
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Backup failed",
          error: result.error,
        });
      }
    } catch (error) {
      console.error("[BACKUP] Manual backup error:", error);
      res.status(500).json({
        success: false,
        message: "Backup failed",
        error: error.message,
      });
    }
  }
);

module.exports = router;

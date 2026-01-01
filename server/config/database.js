const mysql = require("mysql2/promise");
const dns = require("dns");
require("dotenv").config();

// Force IPv4 resolution to avoid IPv6 connection issues
dns.setDefaultResultOrder("ipv4first");

// Determine database name based on NODE_ENV
const getDatabaseName = () => {
  const env = process.env.NODE_ENV || "development";
  const baseName = process.env.DB_NAME || "wms_db";

  // Use the same database but different table prefixes
  return baseName;
};

// Get table prefix based on environment
const getTablePrefix = () => {
  const env = process.env.NODE_ENV || "development";

  // For now, always return empty prefix since data exists without prefixes
  return "";

  if (env === "production") {
    return process.env.TABLE_PREFIX_PROD || "";
  } else if (env === "development") {
    return process.env.TABLE_PREFIX_DEV || "dev_";
  } else if (env === "test") {
    return process.env.TABLE_PREFIX_TEST || "test_";
  }

  return "";
};

// Get environment-specific database configuration
const getDatabaseConfig = () => {
  const env = process.env.NODE_ENV || "development";

  return {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: getDatabaseName(),
    port: process.env.DB_PORT || 3306,
  };
};

// Create MySQL connection pool with environment-specific configuration
const pool = mysql.createPool({
  ...getDatabaseConfig(),
  // Enhanced connection pool settings for scalability
  connectionLimit: parseInt(process.env.DB_MAX_CONNECTIONS) || 20, // Maximum connections
  // MySQL specific settings
  charset: "utf8mb4",
  timezone: "+00:00",
  // Connection timeout settings
  connectTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000, // 10 seconds
  // SSL configuration - disable for now since server doesn't support it
  ssl: false,
  // Additional MySQL settings
  multipleStatements: false,
  dateStrings: false,
  debug: process.env.NODE_ENV === "development" ? false : false,
  // Pool settings
  queueLimit: 0,
});

// Enhanced connection monitoring for MySQL
pool.on("connection", (connection) => {
  const env = process.env.NODE_ENV || "development";
  const dbName = getDatabaseName();
  const prefix = getTablePrefix();
  console.log(
    `Connected to MySQL database: ${dbName} (${env} environment, prefix: '${prefix}')`
  );
  // Set MySQL specific settings
  connection.query(
    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'"
  );
  connection.query("SET SESSION wait_timeout = 28800"); // 8 hours
});

pool.on("error", (err) => {
  console.error("MySQL database connection error:", err);
  // Don't exit the process, let the pool handle reconnection
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Closing MySQL database pool...");
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Closing MySQL database pool...");
  await pool.end();
  process.exit(0);
});

// Helper function to get table name with prefix
const getTableName = (tableName) => {
  const prefix = getTablePrefix();
  return `${prefix}${tableName}`;
};

// Export both pool and helper functions
module.exports = {
  pool,
  getTableName,
  getTablePrefix,
  getDatabaseName,
  getDatabaseConfig,
};

const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const updateSchema = require("./scripts/updateSchema");
const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");
const dbHealthCheck = require("./middleware/dbHealthCheck");
const { recordRequestMetrics } = require("./middleware/warehouseMonitor");
const { pool } = require("./config/database");
const { initializeBackupCron } = require("./services/backupService");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Set server timeout to handle long-running operations like barcode generation
server.timeout = 300000; // 5 minutes timeout
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      // In production, be more permissive for VPS deployment
      if (process.env.NODE_ENV === "production") {
        console.log(
          "Socket.IO CORS: Production mode - allowing origin:",
          origin
        );
        return callback(null, true);
      }

      const allowedOrigins = [
        process.env.CLIENT_URL || "http://localhost:3000",
        "http://localhost:3000",
        "https://localhost:3000",
        "http://localhost:5001",
        "https://localhost:5001",
        process.env.VPS_DOMAIN || "https://your-vps-domain.com",
      ];

      if (allowedOrigins.includes(origin)) {
        console.log("Socket.IO CORS: Origin allowed:", origin);
        callback(null, true);
      } else {
        console.log("Socket.IO CORS: Origin rejected:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// CORS configuration for VPS deployment
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // In production, be more permissive for VPS deployment
    if (process.env.NODE_ENV === "production") {
      console.log("CORS: Production mode - allowing origin:", origin);
      return callback(null, true);
    }

    const allowedOrigins = [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://localhost:3000",
      "https://localhost:3000",
      "http://localhost:5001",
      "https://localhost:5001",
      // Add your VPS domain here
      process.env.VPS_DOMAIN || "https://your-vps-domain.com",
      // Add common VPS patterns
      "http://localhost",
      "https://localhost",
      "http://127.0.0.1:3000",
      "https://127.0.0.1:3000",
      "http://127.0.0.1:5001",
      "https://127.0.0.1:5001",
    ];

    // Log all origins for debugging
    console.log("CORS checking origin:", origin);
    console.log("Allowed origins:", allowedOrigins);

    if (allowedOrigins.includes(origin)) {
      console.log("CORS: Origin allowed");
      callback(null, true);
    } else {
      // Log the rejected origin for debugging
      console.log("CORS rejected origin:", origin);
      console.log("CORS: Please add this origin to allowedOrigins array");
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(requestLogger);
app.use(recordRequestMetrics);

// Serve static files (uploaded images)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve static files from React build (for production)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
}

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/products", require("./routes/products"));
app.use("/api/barcodes", require("./routes/barcodes"));
app.use("/api/inventory", require("./routes/inventory"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/alerts", require("./routes/alerts"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/scanner", require("./routes/barcode-scanner"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/direct-print", require("./routes/direct-print"));
app.use("/api/stock", require("./routes/stock"));
app.use("/api/system", require("./routes/system"));
app.use("/api/update-barcodes", require("./routes/update-barcodes"));

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join_room", (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "Reason:", reason);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });
});

// Add Socket.IO error handling
io.engine.on("connection_error", (err) => {
  console.error("Socket.IO connection error:", err);
});

// Test database connection on startup
const testDatabaseConnection = async () => {
  try {
    const [rows] = await pool.execute("SELECT 1 as test");
    console.log("✅ Database connection successful");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// SPA routing for production (serve React app for all non-API routes)
if (process.env.NODE_ENV === "production") {
  // Serve React app for all non-API routes
  app.get("*", (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith("/api/")) {
      return next();
    }

    // Check if build file exists
    const buildPath = path.join(__dirname, "../client/build", "index.html");
    const fs = require("fs");

    if (fs.existsSync(buildPath)) {
      res.sendFile(buildPath);
    } else {
      res.status(500).json({
        success: false,
        message: "Client build not found. Please run 'npm run build' first.",
        error: "ENOENT: no such file or directory, stat '" + buildPath + "'",
      });
    }
  });
} else {
  // 404 handler for development
  app.use("*", (req, res) => {
    res.status(404).json({
      success: false,
      message: "Route not found",
    });
  });
}

const PORT = process.env.PORT || 5001;

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Test database connection
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error("❌ Server started but database connection failed!");
  }

  // Initialize database backup cron job (runs daily at 2 AM IST)
  try {
    initializeBackupCron();
  } catch (error) {
    console.error("❌ Failed to initialize backup cron job:", error);
  }

  // Update database schema on startup
  await updateSchema();
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

module.exports = { app, io };

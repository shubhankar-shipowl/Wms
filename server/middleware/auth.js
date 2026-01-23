const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    try {
      const [rows] = await pool.execute(
        "SELECT id, username, email, role FROM users WHERE id = ?",
        [decoded.userId]
      );

      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid token",
        });
      }

      req.user = rows[0];
      next();
    } catch (dbError) {
      // Handle database connection errors
      if (
        dbError.code === 'ECONNRESET' ||
        dbError.code === 'ECONNREFUSED' ||
        dbError.message.includes('ENETUNREACH')
      ) {
        console.error('Database connection error during authentication:', dbError.message);
        return res.status(503).json({
          success: false,
          message: "Database connection error. Please try again.",
        });
      }
      // Re-throw other database errors
      throw dbError;
    }
  } catch (error) {
    // JWT verification errors
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired token",
      });
    }
    // Other errors
    console.error('Authentication error:', error);
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole,
  JWT_SECRET,
};

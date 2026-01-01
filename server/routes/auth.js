const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const { pool, getTableName } = require("../config/database");
const { authenticateToken, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

// Validation schemas
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid("admin", "user", "viewer").default("user"),
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { username, password } = req.body;

    // Get user from database
    const [rows] = await pool.execute(
      `SELECT id, username, email, password_hash, role FROM ${getTableName(
        "users"
      )} WHERE username = ?`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const user = rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Update last login
    await pool.execute(`UPDATE users SET last_login = NOW() WHERE id = ?`, [
      user.id,
    ]);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Register (admin only)
router.post("/register", authenticateToken, async (req, res) => {
  try {
    // Only admins can create new users
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admins can create new users",
      });
    }

    const { error } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { username, email, password, role } = req.body;

    // Check if user already exists
    const [existingUserRows] = await pool.execute(
      `SELECT id FROM products WHERE username = ? OR email = ?`,
      [username, email]
    );

    if (existingUserRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Username or email already exists",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const [result] = await pool.execute(
      `INSERT INTO ${getTableName(
        "users"
      )} (username, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [username, email, passwordHash, role]
    );

    // Get the created user
    const [newUserRows] = await pool.execute(
      `SELECT id, username, email, role FROM ${getTableName(
        "users"
      )} WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        user: newUserRows[0],
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get current user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, email, role, created_at, last_login FROM ${getTableName(
        "users"
      )} WHERE id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        user: rows[0],
      },
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Change password
const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(6).required(),
});

router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { error } = changePasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    // Get current user's password hash
    const [rows] = await pool.execute(
      `SELECT password_hash FROM ${getTableName("users")} WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(
      current_password,
      user.password_hash
    );
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(new_password, 10);

    // Update password
    await pool.execute(
      `UPDATE ${getTableName("users")} SET password_hash = ? WHERE id = ?`,
      [newPasswordHash, userId]
    );

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Verify token
router.get("/verify", authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: "Token is valid",
    data: {
      user: req.user,
    },
  });
});

module.exports = router;

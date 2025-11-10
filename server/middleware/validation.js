const Joi = require("joi");

// Common validation schemas
const schemas = {
  // Product validation
  product: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    sku: Joi.string().min(1).max(100).required(),
    price: Joi.number().positive().precision(2).required(),
    stock_quantity: Joi.number().integer().min(0).required(),
    low_stock_threshold: Joi.number().integer().min(0).default(10),
    unit: Joi.string().max(50).default("pcs"),
    category: Joi.string().max(100).allow(""),
    description: Joi.string().max(1000).allow(""),
    status: Joi.string().valid("active", "inactive").default("active"),
    hsn_code: Joi.string().min(4).max(20).required().messages({
      "string.min": "HSN code must be at least 4 characters",
      "string.max": "HSN code must not exceed 20 characters",
      "any.required": "HSN code is required",
    }),
    gst_rate: Joi.number().min(0).max(100).precision(2).required().messages({
      "number.min": "GST rate must be at least 0%",
      "number.max": "GST rate must not exceed 100%",
      "any.required": "GST rate is required",
    }),
    rack: Joi.string().max(50).allow(""),
  }),

  // Barcode validation
  barcode: Joi.object({
    product_id: Joi.number().integer().positive().required(),
    quantity: Joi.number().integer().min(1).max(1000).required(),
    units_assigned: Joi.number().integer().min(1).max(100).default(1),
  }),

  // Stock operation validation
  stockOperation: Joi.object({
    barcode: Joi.string().min(1).max(50).required(),
    quantity: Joi.number().integer().min(1).max(1000).required(),
    notes: Joi.string().max(500).allow(""),
  }),

  // Transaction validation
  transaction: Joi.object({
    product_id: Joi.number().integer().positive().required(),
    type: Joi.string().valid("in", "out").required(),
    quantity: Joi.number().integer().positive().required(),
    unit_price: Joi.number().positive().precision(2).default(0),
    notes: Joi.string().max(500).allow(""),
    reference_number: Joi.string().max(100).allow(""),
  }),

  // Pagination validation
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort_by: Joi.string()
      .valid("id", "name", "created_at", "updated_at")
      .default("id"),
    sort_order: Joi.string().valid("asc", "desc").default("desc"),
  }),

  // Date range validation
  dateRange: Joi.object({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().min(Joi.ref("start_date")).optional(),
    days: Joi.number().integer().min(1).max(365).default(30),
  }),

  // User validation
  user: Joi.object({
    username: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(100).required(),
    role: Joi.string().valid("admin", "user", "viewer").default("user"),
  }),

  // Login validation
  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
  }),
};

// Validation middleware factory
const validate = (schema, property = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
          value: detail.context?.value,
        })),
      });
    }

    // Replace the request property with validated and sanitized data
    req[property] = value;
    next();
  };
};

// Specific validation middlewares
const validateProduct = validate(schemas.product);
const validateBarcode = validate(schemas.barcode);
const validateStockOperation = validate(schemas.stockOperation);
const validateTransaction = validate(schemas.transaction);
const validatePagination = validate(schemas.pagination, "query");
const validateDateRange = validate(schemas.dateRange, "query");
const validateUser = validate(schemas.user);
const validateLogin = validate(schemas.login);

module.exports = {
  schemas,
  validate,
  validateProduct,
  validateBarcode,
  validateStockOperation,
  validateTransaction,
  validatePagination,
  validateDateRange,
  validateUser,
  validateLogin,
};

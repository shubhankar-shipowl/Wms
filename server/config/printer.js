// Thermal Printer Configuration - Optimized for TSC TE244 with 50mm x 25mm labels
module.exports = {
  // Connection type: 'usb', 'serial', 'network', 'cups', 'pdf', 'auto', or 'none' (for VPS without printer)
  connectionType: process.env.PRINTER_CONNECTION_TYPE || "auto",

  // Network printer settings (if using network connection)
  network: {
    ip: process.env.PRINTER_IP || "192.168.1.100",
    port: process.env.PRINTER_PORT || 9100,
    timeout: 5000,
  },

  // USB printer settings (for TSC TE244)
  usb: {
    vendorId: process.env.PRINTER_VENDOR_ID || "0x04f9", // TSC vendor ID
    productId: process.env.PRINTER_PRODUCT_ID || "0x2042", // TSC TE244 product ID
    devicePath: process.env.PRINTER_USB_PATH || "/dev/usb/lp0", // Linux USB device path
    timeout: 5000,
  },

  // Serial/RS232 printer settings (for TSC TE244)
  serial: {
    port: process.env.PRINTER_SERIAL_PORT || "/dev/ttyUSB0", // Linux serial port
    baudRate: process.env.PRINTER_BAUD_RATE || 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    timeout: 5000,
  },

  // Windows printer settings
  windows: {
    printerName: process.env.PRINTER_NAME || null, // Set to null to auto-detect
    useDefaultPrinter: process.env.USE_DEFAULT_PRINTER !== "false", // Use default printer if available
    autoDetectTSC: true, // Automatically detect TSC printers
  },

  // Printer-specific settings (50mm x 25mm label)
  settings: {
    width: 50, // mm
    height: 25, // mm
    dpi: 203, // dots per inch
    encoding: "utf8",
    // Convert mm to dots: 1mm = 8 dots at 203 DPI
    widthDots: 400, // 50mm * 8 = 400 dots
    heightDots: 200, // 25mm * 8 = 200 dots
  },

  // TSPL2 commands for TSC TE244 thermal printer - OPTIMIZED for 50mm x 25mm
  commands: {
    // Basic setup commands - OPTIMIZED for 50mm x 25mm labels
    size: "SIZE 50 mm, 25 mm\r\n",
    gap: "GAP 2 mm, 2 mm\r\n",
    direction: "DIRECTION 1\r\n", // 90° rotation for proper orientation
    reference: "REFERENCE 0,0\r\n",
    offset: "OFFSET 0 mm\r\n",
    set: "SET PEEL OFF\r\n",
    cls: "CLS\r\n",

    // Print settings - OPTIMIZED for 50mm x 25mm
    density: "DENSITY 7\r\n", // Good density for clear printing
    speed: "SPEED 4\r\n", // Optimal speed for 50mm x 25mm labels

    // Text positioning (in dots) - OPTIMIZED for 50mm x 25mm with DIRECTION 1
    text: {
      center: function (y, text) {
        // Centered for barcode number: x=100 (center of 200 dots)
        return `TEXT 60,${y},"3",0,1,1,"${text}"\r\n`;
      },
      left: function (y, text) {
        return `TEXT 10,${y},"3",0,1,1,"${text}"\r\n`;
      },
      small: function (y, text) {
        return `TEXT 10,${y},"2",0,1,1,"${text}"\r\n`;
      },
      sku: function (y, text) {
        // SKU positioned at top left with proper spacing
        return `TEXT 140,${y},"2",0,1,1,"${text}"\r\n`;
      },
    },

    // Barcode positioning - OPTIMIZED for 50mm x 25mm with DIRECTION 1
    barcode: {
      code128: function (y, data) {
        // Centered barcode within 200-dot width: x=100, height=50 for scannability
        return `BARCODE 70,${y},"128",50,0,0,2,2,"${data}"\r\n`;
      },
      code39: function (y, data) {
        return `BARCODE 100,${y},"39",50,0,0,2,2,"${data}"\r\n`;
      },
      ean13: function (y, data) {
        return `BARCODE 100,${y},"EAN13",50,0,0,2,2,"${data}"\r\n`;
      },
    },

    // Print commands - OPTIMIZED for 50mm x 25mm
    print: "PRINT 1\r\n",
    cut: "CUT\r\n",
    feed: "FEED 2\r\n",
  },

  // Pre-built label templates - OPTIMIZED for 50mm x 25mm
  templates: {
    // Simple barcode label - OPTIMIZED for 50mm x 25mm
    simpleBarcode: function (data) {
      return [
        this.commands.cls,
        this.commands.size,
        this.commands.gap,
        this.commands.direction,
        this.commands.density,
        this.commands.speed,
        this.commands.barcode.code128(40, data),
        this.commands.print,
      ].join("");
    },

    // SKU + barcode + number - OPTIMIZED for 50mm x 25mm
    completeSKULabel: function (sku) {
      return [
        this.commands.cls,
        this.commands.size,
        this.commands.gap,
        this.commands.direction,
        this.commands.density,
        this.commands.speed,
        this.commands.text.small(10, `SKU: ${sku}`),
        this.commands.barcode.code128(60, sku),
        this.commands.print,
      ].join("");
    },
  },

  // ESC/POS commands (fallback for other printers)
  escpos: {
    init: "\x1B\x40", // Initialize printer
    center: "\x1B\x61\x01", // Center alignment
    left: "\x1B\x61\x00", // Left alignment
    normal: "\x1B\x21\x00", // Normal text size
    small: "\x1B\x21\x08", // Small text size
    bold: "\x1B\x21\x08", // Bold text
    cut: "\x1D\x56\x00", // Cut paper
    feed: "\x0A", // Line feed
  },

  // Helper functions
  helpers: {
    // Calculate center position for text based on character count
    getCenterPosition: function (textLength) {
      const charWidth = 12; // Average character width in dots
      const labelWidth = 200; // 25mm in dots (rotated)
      return Math.max(20, (labelWidth - textLength * charWidth) / 2);
    },

    // Validate barcode data
    validateBarcodeData: function (data, type = "code128") {
      switch (type.toLowerCase()) {
        case "code128":
          return /^[\x20-\x7E]*$/.test(data); // ASCII printable characters
        case "code39":
          return /^[A-Z0-9\-. $/+%]*$/.test(data);
        case "ean13":
          return /^\d{12,13}$/.test(data);
        default:
          return true;
      }
    },
  },
};

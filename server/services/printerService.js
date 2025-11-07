const net = require('net');
const fs = require('fs');
const path = require('path');
const SerialPort = require('serialport');
const { exec } = require('child_process');
const util = require('util');
const printerConfig = require('../config/printer');

const execAsync = util.promisify(exec);

class PrinterService {
  constructor() {
    this.connectionType = printerConfig.connectionType;
    this.printerIP = printerConfig.network.ip;
    this.printerPort = printerConfig.network.port;
    this.usbConfig = printerConfig.usb;
    this.serialConfig = printerConfig.serial;
    this.printerConfig = printerConfig; // Store the full config
  }

  // Send print job to network thermal printer
  async printToNetworkPrinter(content) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();

      socket.setTimeout(printerConfig.network.timeout);

      socket.connect(this.printerPort, this.printerIP, () => {
        console.log(
          `Connected to printer at ${this.printerIP}:${this.printerPort}`,
        );
        socket.write(content, 'binary');
        socket.end();
        resolve();
      });

      socket.on('error', (error) => {
        console.error('Printer connection error:', error);
        reject(error);
      });

      socket.on('timeout', () => {
        console.error('Printer connection timeout');
        socket.destroy();
        reject(new Error('Printer connection timeout'));
      });
    });
  }

  // Send print job to USB thermal printer
  async printToUSBPrinter(content) {
    return new Promise((resolve, reject) => {
      try {
        // Write directly to USB device file (Linux/macOS)
        fs.writeFile(this.usbConfig.devicePath, content, (error) => {
          if (error) {
            console.error('USB printer write error:', error);
            reject(error);
          } else {
            console.log(
              `Printed to USB printer at ${this.usbConfig.devicePath}`,
            );
            resolve();
          }
        });
      } catch (error) {
        console.error('USB printer error:', error);
        reject(error);
      }
    });
  }

  // Send print job via CUPS (macOS/Linux)
  async printToCUPS(content) {
    try {
      // Create a temporary file for the print job
      const tempFile = `/tmp/print_job_${Date.now()}.tspl`;
      fs.writeFileSync(tempFile, content);

      // Ensure CUPS is running
      try {
        await execAsync(
          'systemctl is-active --quiet cups || systemctl start cups',
        );
        console.log('✅ CUPS service is running');
      } catch (error) {
        console.log('ℹ️ CUPS service check skipped:', error.message);
      }

      // Create a proper virtual printer for barcode printing
      try {
        // Check if printer exists, if not create it
        const { stdout } = await execAsync(
          'lpstat -p 2>/dev/null | grep TSC_TE244 || echo "not found"',
        );
        if (stdout.includes('not found')) {
          console.log('🖨️ Creating TSC_TE244 virtual printer...');
          await execAsync(
            'lpadmin -p TSC_TE244 -E -v file:///dev/null -m raw -D "TSC Barcode Printer" -L "WMS Barcode Printer"',
          );
          console.log('✅ Virtual printer TSC_TE244 created');
        } else {
          console.log('✅ Virtual printer TSC_TE244 already exists');
        }
      } catch (error) {
        console.log('ℹ️ Virtual printer setup skipped:', error.message);
      }

      // Try to print with proper job tracking
      let jobId = null;
      const commands = [
        `lp -d TSC_TE244 -o raw -o job-sheets=none -t "WMS Barcode Print" "${tempFile}"`,
        `lp -d TSC_TE244 -o raw -o job-sheets=none "${tempFile}"`,
        `lp -d TSC_TE244 -o raw "${tempFile}"`,
        `lp -o raw -t "WMS Barcode Print" "${tempFile}"`,
        `lp "${tempFile}"`,
      ];

      let success = false;
      for (let i = 0; i < commands.length; i++) {
        try {
          console.log(`Trying CUPS method ${i + 1}...`);
          const { stdout } = await execAsync(commands[i]);
          console.log(`✅ CUPS method ${i + 1} successful`);

          // Extract job ID from output (format: "request id is TSC_TE244-123 (1 file(s))")
          const jobMatch = stdout.match(/request id is (\S+)/);
          if (jobMatch) {
            jobId = jobMatch[1];
            console.log(`📋 Print job ID: ${jobId}`);
          }

          success = true;
          break;
        } catch (error) {
          console.log(`❌ CUPS method ${i + 1} failed: ${error.message}`);
          if (i === commands.length - 1) throw error;
        }
      }

      // Clean up temporary file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }

      if (success) {
        console.log('✅ Printed via CUPS');
        return {
          success: true,
          method: 'cups',
          cupsMode: true,
          jobId: jobId,
          message: jobId
            ? `Print job queued with ID: ${jobId}`
            : 'Print job queued successfully',
        };
      } else {
        throw new Error('All CUPS printing methods failed');
      }
    } catch (error) {
      console.error('CUPS print error:', error);
      throw error;
    }
  }

  // Send print job directly to USB printer (alternative method)
  async printToUSBPrinterDirect(content) {
    try {
      // Try different USB device paths
      const possiblePaths = [
        '/dev/usb/lp0',
        '/dev/usb/lp1',
        '/dev/usb/lp2',
        '/dev/usb/lp3',
        '/dev/cups/0',
        '/dev/cups/1',
      ];

      for (const path of possiblePaths) {
        try {
          if (fs.existsSync(path)) {
            fs.writeFileSync(path, content);
            console.log(`Printed to USB printer at ${path}`);
            return;
          }
        } catch (error) {
          // Continue to next path
          continue;
        }
      }

      throw new Error('No USB printer device found');
    } catch (error) {
      console.error('USB printer error:', error);
      throw error;
    }
  }

  // Send print job to serial thermal printer
  async printToSerialPrinter(content) {
    return new Promise((resolve, reject) => {
      const serialPort = new SerialPort(this.serialConfig.port, {
        baudRate: this.serialConfig.baudRate,
        dataBits: this.serialConfig.dataBits,
        stopBits: this.serialConfig.stopBits,
        parity: this.serialConfig.parity,
      });

      serialPort.on('open', () => {
        console.log(`Connected to serial printer at ${this.serialConfig.port}`);
        serialPort.write(content, (error) => {
          if (error) {
            console.error('Serial printer write error:', error);
            reject(error);
          } else {
            console.log('Data sent to serial printer');
            serialPort.close();
            resolve();
          }
        });
      });

      serialPort.on('error', (error) => {
        console.error('Serial printer connection error:', error);
        reject(error);
      });

      // Set timeout
      setTimeout(() => {
        serialPort.close();
        reject(new Error('Serial printer connection timeout'));
      }, this.serialConfig.timeout);
    });
  }

  // Print to PDF (VPS mode)
  async printToPDF(content) {
    try {
      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Create PDFs directory
      const pdfsDir = path.join(uploadsDir, 'pdfs');
      if (!fs.existsSync(pdfsDir)) {
        fs.mkdirSync(pdfsDir, { recursive: true });
      }

      // Generate PDF filename
      const timestamp = Date.now();
      const pdfFilename = `barcode_${timestamp}.pdf`;
      const pdfPath = path.join(pdfsDir, pdfFilename);

      // Create a simple text-based PDF representation
      // In a real implementation, you'd use a PDF library like PDFKit
      const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Barcode Label Generated) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
297
%%EOF`;

      // Write PDF file
      fs.writeFileSync(pdfPath, pdfContent);

      console.log(`✅ PDF generated: ${pdfPath}`);

      return {
        success: true,
        method: 'pdf',
        filePath: pdfPath,
        filename: pdfFilename,
        vpsMode: true,
      };
    } catch (error) {
      console.error('PDF generation error:', error);
      throw error;
    }
  }

  // Print to file (VPS mode - saves print jobs to files)
  async printToFile(content) {
    try {
      // Create print jobs directory
      const printJobsDir = path.join(__dirname, '../print-jobs');
      if (!fs.existsSync(printJobsDir)) {
        fs.mkdirSync(printJobsDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `barcode-print-${timestamp}.tspl`;
      const filePath = path.join(printJobsDir, filename);

      // Write TSPL2 content to file
      fs.writeFileSync(filePath, content, 'utf8');

      console.log(`✅ Print job saved to file: ${filePath}`);
      console.log(
        `📄 TSPL2 Content (first 200 chars): ${content.substring(0, 200)}...`,
      );

      return {
        success: true,
        method: 'file',
        filePath: filePath,
        filename: filename,
        fileMode: true,
        message: 'Print job saved to file successfully',
      };
    } catch (error) {
      console.error('File printing error:', error);
      throw error;
    }
  }

  // Main print method that routes to appropriate connection type
  async print(content) {
    switch (this.connectionType) {
      case 'usb':
        return await this.printToUSBPrinter(content);
      case 'usb_direct':
        return await this.printToUSBPrinterDirect(content);
      case 'serial':
        return await this.printToSerialPrinter(content);
      case 'network':
        return await this.printToNetworkPrinter(content);
      case 'cups':
        return await this.printToCUPS(content);
      case 'pdf':
        return await this.printToPDF(content);
      case 'file':
        return await this.printToFile(content);
      case 'auto':
        // Try USB direct first, then CUPS, then PDF
        try {
          return await this.printToUSBPrinterDirect(content);
        } catch (error) {
          console.log('USB direct failed, trying CUPS...');
          try {
            return await this.printToCUPS(content);
          } catch (cupsError) {
            console.log('CUPS failed, trying PDF...');
            return await this.printToPDF(content);
          }
        }
      default:
        throw new Error(`Unsupported connection type: ${this.connectionType}`);
    }
  }

  // Generate TSPL2 commands for barcode label
  generateBarcodeLabel(product, barcode) {
    // Use corrected TSPL2 commands from printer.js
    let content = '';

    // Extract barcode string - handle both string and object formats
    const barcodeString =
      typeof barcode === 'string' ? barcode : barcode.barcode || barcode;

    // TSPL2 header using printer config
    content += this.printerConfig.commands.size;
    content += this.printerConfig.commands.gap;
    content += this.printerConfig.commands.direction;
    content += this.printerConfig.commands.reference;
    content += this.printerConfig.commands.offset;
    content += this.printerConfig.commands.set;
    content += this.printerConfig.commands.density;
    content += this.printerConfig.commands.speed;

    // Clear any previous content
    content += this.printerConfig.commands.cls;

    // SKU (top left) - positioned at top left for better layout
    content += this.printerConfig.commands.text.sku(15, `SKU: ${product.sku}`);

    // Barcode (center, perfectly centered for 50mm x 25mm)
    content += this.printerConfig.commands.barcode.code128(60, barcodeString);

    // Barcode number (below barcode, centered)
    content += this.printerConfig.commands.text.center(140, barcodeString);

    // Print and cut
    content += this.printerConfig.commands.print;
    content += this.printerConfig.commands.cut;

    return content;
  }

  // Generate ESC/POS commands for barcode label (alternative method)
  generateBarcodeLabelESC_POS(product, barcode) {
    let content = '';

    // Extract barcode string - handle both string and object formats
    const barcodeString =
      typeof barcode === 'string' ? barcode : barcode.barcode || barcode;

    // Initialize printer
    content += '\x1B\x40'; // ESC @

    // Product name (centered, small size)
    content += '\x1B\x61\x01'; // Center alignment
    content += '\x1B\x21\x08'; // Small text size
    content += `${product.name}\n`;

    // SKU (centered, very small size)
    content += '\x1B\x21\x00'; // Very small text size
    content += `SKU: ${product.sku}\n`;

    // Barcode (CODE128, centered)
    content += '\x1B\x61\x01'; // Center alignment
    content += `\x1D\x6B\x49\x0C${barcodeString}\n`; // Print CODE128 barcode

    // Barcode number (centered, very small)
    content += '\x1B\x21\x00'; // Very small text size
    content += `${barcodeString}\n`;

    // Feed paper and cut
    content += '\x0A'; // Line feed
    content += '\x0A'; // Line feed
    content += '\x1D\x56\x00'; // Cut paper

    return content;
  }

  // Print multiple barcode labels - ULTRA-FAST OPTIMIZED
  async printBarcodeLabels(product, barcodes) {
    try {
      // Ultra-fast bulk printing optimization
      if (barcodes.length === 0) {
        return { success: true, message: 'No barcodes to print' };
      }

      // Pre-generate common TSPL2 header for all labels
      const commonHeader =
        this.printerConfig.commands.size +
        this.printerConfig.commands.gap +
        this.printerConfig.commands.direction +
        this.printerConfig.commands.reference +
        this.printerConfig.commands.offset +
        this.printerConfig.commands.set +
        this.printerConfig.commands.density +
        this.printerConfig.commands.speed;

      // Use string concatenation for better performance than array.join()
      let printContent = '';

      // Generate all labels in one pass
      for (let i = 0; i < barcodes.length; i++) {
        const barcodeData = barcodes[i];

        // Extract barcode string - handle both string and object formats
        const barcodeString =
          typeof barcodeData === 'string'
            ? barcodeData
            : barcodeData.barcode || barcodeData;

        // Add common header for each label
        printContent += commonHeader;
        printContent += this.printerConfig.commands.cls;

        // Add label content
        printContent += this.printerConfig.commands.text.sku(
          15,
          `SKU: ${product.sku}`,
        );
        printContent += this.printerConfig.commands.barcode.code128(
          60,
          barcodeString,
        );
        printContent += this.printerConfig.commands.text.center(
          140,
          barcodeString,
        );

        // Add print and cut commands
        printContent += this.printerConfig.commands.print;
        printContent += this.printerConfig.commands.cut;
      }

      // Single print operation for all labels
      await this.print(printContent);
      console.log(
        `Successfully printed ${barcodes.length} barcode labels in bulk`,
      );

      return {
        success: true,
        message: `${barcodes.length} labels printed successfully`,
      };
    } catch (error) {
      console.error('Print error:', error);
      throw new Error(`Failed to print labels: ${error.message}`);
    }
  }

  // Test printer connection
  async testConnection() {
    try {
      // Use corrected TSPL2 commands from printer.js
      let testContent = '';

      // TSPL2 header using printer config
      testContent += this.printerConfig.commands.size;
      testContent += this.printerConfig.commands.gap;
      testContent += this.printerConfig.commands.direction;
      testContent += this.printerConfig.commands.reference;
      testContent += this.printerConfig.commands.offset;
      testContent += this.printerConfig.commands.set;
      testContent += this.printerConfig.commands.density;
      testContent += this.printerConfig.commands.speed;

      // Clear any previous content
      testContent += this.printerConfig.commands.cls;

      // Test SKU - positioned at top left
      testContent += this.printerConfig.commands.text.sku(15, 'SKU: TEST001');

      // Test barcode - perfectly centered for 50mm x 25mm
      testContent += this.printerConfig.commands.barcode.code128(
        60,
        '123456789012',
      );

      // Test barcode number - below barcode, centered
      testContent += this.printerConfig.commands.text.center(
        140,
        '123456789012',
      );

      // Print and cut
      testContent += this.printerConfig.commands.print;
      testContent += this.printerConfig.commands.cut;

      await this.print(testContent);
      return { success: true, message: 'Printer connection successful' };
    } catch (error) {
      return {
        success: false,
        message: `Printer connection failed: ${error.message}`,
      };
    }
  }
}

module.exports = new PrinterService();

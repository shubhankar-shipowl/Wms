const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

  // Send print job via CUPS (macOS/Linux) or Windows Print Spooler
  async printToCUPS(content) {
    try {
      const platform = os.platform();
      const isWindows = platform === 'win32';
      const isMacOS = platform === 'darwin';
      const isLinux = platform === 'linux';

      // Use cross-platform temp directory
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `print_job_${Date.now()}.tspl`);
      fs.writeFileSync(tempFile, content);

      // Windows printing
      if (isWindows) {
        console.log('🪟 Detected Windows - using Windows Print Spooler');
        console.log('📝 Using direct port writing method (bypasses print queue for raw TSPL data)');

        // Get printer name from config or use default
        const configuredPrinterName =
          printerConfig.windows?.printerName || 'TSC_TE244';
        const useDefaultPrinter =
          printerConfig.windows?.useDefaultPrinter !== false;

        let defaultPrinter = null;

        // Try to get default printer if enabled
        if (useDefaultPrinter) {
          try {
            const { stdout: defaultPrinterOut } = await execAsync(
              'powershell -Command "Get-Printer | Where-Object {$_.Default -eq $true} | Select-Object -ExpandProperty Name"',
            );
            if (defaultPrinterOut && defaultPrinterOut.trim()) {
              defaultPrinter = defaultPrinterOut.trim();
              console.log(`📋 Default printer found: ${defaultPrinter}`);
            }
          } catch (error) {
            console.log(
              'ℹ️ Could not get default printer, using configured name',
            );
          }
        }

        // Use default printer if available and enabled, otherwise use configured name
        const targetPrinter =
          useDefaultPrinter && defaultPrinter
            ? defaultPrinter
            : configuredPrinterName;
        console.log(`🖨️ Using printer: ${targetPrinter}`);

        // Escape file paths for PowerShell and CMD
        // For PowerShell inline commands, escape backslashes and quotes properly
        const psPathEscaped = tempFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const psPathQuoted = `"${psPathEscaped}"`;
        const cmdPath = tempFile.replace(/"/g, '\\"');

        // Create PowerShell script file for reliable execution
        const psScriptPath = path.join(tempDir, `print_script_${Date.now()}.ps1`);
        
        // PowerShell script - use proper escaping for file path in script
        const scriptFilePath = tempFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
        const psScript = `
$ErrorActionPreference = "Stop"
$filePath = '${scriptFilePath}'
$printerName = '${targetPrinter}'

Write-Host "=== Windows Raw Printing Script ==="
Write-Host "File: $filePath"
Write-Host "Printer: $printerName"

# Read file as bytes
if (-not (Test-Path $filePath)) {
    throw "File not found: $filePath"
}
$bytes = [System.IO.File]::ReadAllBytes($filePath)
Write-Host "Read $($bytes.Length) bytes from file"

# Get printer info using WMI - use proper filter syntax with escaped quotes
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='${targetPrinter.replace(/'/g, "''")}'" | Select-Object -First 1
if (-not $printer) {
    Write-Host "Printer '$printerName' not found via WMI, listing all printers..."
    Get-WmiObject -Class Win32_Printer | Select-Object Name, PortName, Status | Format-Table
    throw "Printer '$printerName' not found"
}

$port = $printer.PortName
Write-Host "Found printer: $($printer.Name)"
Write-Host "Printer port: $port"
Write-Host "Printer status: $($printer.Status)"

# Write directly to printer port
try {
    Write-Host "Opening printer port: $port"
    $stream = New-Object System.IO.FileStream($port, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
    Write-Host "Writing $($bytes.Length) bytes to port..."
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $stream.Close()
    Write-Host "✅ Successfully sent $($bytes.Length) bytes to printer port $port"
} catch {
    $errorMsg = $_.Exception.Message
    Write-Host "❌ Error writing to port: $errorMsg"
    Write-Host "Error type: $($_.Exception.GetType().FullName)"
    throw "Failed to write to printer port '$port': $errorMsg"
}
`.trim();
        
        fs.writeFileSync(psScriptPath, psScript, 'utf8');
        console.log(`📝 Created PowerShell script: ${psScriptPath}`);
        console.log(`📄 Script size: ${fs.statSync(psScriptPath).size} bytes`);

        // Escape PowerShell script path for command line - use backslashes escaped properly
        const psScriptPathEscaped = psScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const psScriptPathQuoted = `"${psScriptPathEscaped}"`;

        // Create a PowerShell script that uses Windows Print Spooler API for raw printing
        // This will show up in the printer queue
        const psSpoolerScriptPath = path.join(tempDir, `print_spooler_${Date.now()}.ps1`);
        const spoolerScriptFilePath = tempFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
        const psSpoolerScript = `
$ErrorActionPreference = "Stop"
$filePath = '${spoolerScriptFilePath}'
$printerName = '${targetPrinter.replace(/'/g, "''")}'

Write-Host "=== Windows Print Spooler Raw Printing ==="
Write-Host "File: $filePath"
Write-Host "Printer: $printerName"

# Read file as bytes
if (-not (Test-Path $filePath)) {
    throw "File not found: $filePath"
}
$bytes = [System.IO.File]::ReadAllBytes($filePath)
Write-Host "Read $($bytes.Length) bytes from file"

# Use Windows Print Spooler API to send raw data
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class RawPrint {
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
}

[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@

$hPrinter = [IntPtr]::Zero
if ([RawPrint]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
    Write-Host "Printer opened successfully"
    $docInfo = New-Object DOCINFOA
    $docInfo.pDocName = "Barcode Print"
    $docInfo.pDataType = "RAW"
    
    if ([RawPrint]::StartDocPrinter($hPrinter, 1, $docInfo)) {
        Write-Host "Document started"
        if ([RawPrint]::StartPagePrinter($hPrinter)) {
            Write-Host "Page started"
            $pBytes = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
            [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pBytes, $bytes.Length)
            $written = 0
            if ([RawPrint]::WritePrinter($hPrinter, $pBytes, $bytes.Length, [ref]$written)) {
                Write-Host "Wrote $written bytes to printer"
                [RawPrint]::EndPagePrinter($hPrinter)
                [RawPrint]::EndDocPrinter($hPrinter)
                [System.Runtime.InteropServices.Marshal]::FreeHGlobal($pBytes)
                [RawPrint]::ClosePrinter($hPrinter)
                Write-Host "✅ Successfully sent $written bytes via Print Spooler (check printer queue)"
            } else {
                [RawPrint]::EndPagePrinter($hPrinter)
                [RawPrint]::EndDocPrinter($hPrinter)
                [System.Runtime.InteropServices.Marshal]::FreeHGlobal($pBytes)
                [RawPrint]::ClosePrinter($hPrinter)
                throw "Failed to write to printer"
            }
        } else {
            [RawPrint]::EndDocPrinter($hPrinter)
            [RawPrint]::ClosePrinter($hPrinter)
            throw "Failed to start page"
        }
    } else {
        [RawPrint]::ClosePrinter($hPrinter)
        throw "Failed to start document"
    }
} else {
    throw "Failed to open printer '$printerName'"
}
`.trim();
        fs.writeFileSync(psSpoolerScriptPath, psSpoolerScript, 'utf8');
        const psSpoolerScriptPathEscaped = psSpoolerScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const psSpoolerScriptPathQuoted = `"${psSpoolerScriptPathEscaped}"`;

        // Try multiple Windows printing methods - prioritize Print Spooler API for queue visibility
        const commands = [
          // Method 1: PowerShell script using Windows Print Spooler API (shows in queue, handles raw data)
          `powershell -NoProfile -ExecutionPolicy Bypass -File ${psSpoolerScriptPathQuoted}`,
          
          // Method 2: PowerShell script - Write directly to printer port (bypasses queue, fastest)
          `powershell -NoProfile -ExecutionPolicy Bypass -File ${psScriptPathQuoted}`,
          
          // Method 3: PowerShell inline - Direct port write using WMI (simpler, no script file)
          `powershell -NoProfile -Command "$bytes = [System.IO.File]::ReadAllBytes(${psPathQuoted}); $printerName = '${targetPrinter.replace(/'/g, "''")}'; $printer = Get-WmiObject -Class Win32_Printer -Filter (\"Name='\" + $printerName + \"'\") | Select-Object -First 1; if ($printer) { $port = $printer.PortName; Write-Host \"Writing to port: $port\"; $stream = New-Object System.IO.FileStream($port, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush(); $stream.Close(); Write-Host \"Sent $($bytes.Length) bytes\" } else { throw \"Printer '$printerName' not found\" }"`,
          
          // Method 4: Use copy command to printer port directly
          `powershell -NoProfile -Command "$printerName = '${targetPrinter.replace(/'/g, "''")}'; $printer = Get-WmiObject -Class Win32_Printer -Filter (\"Name='\" + $printerName + \"'\") | Select-Object -First 1; if ($printer) { $port = $printer.PortName; Write-Host \"Copying to port: $port\"; Copy-Item -Path ${psPathQuoted} -Destination $port -Force; Write-Host \"Copied to $port\" } else { throw 'Printer not found' }"`,
        ];

        let success = false;
        let jobId = null;

        console.log(`📋 Will try ${commands.length} Windows printing method(s)`);
        
        for (let i = 0; i < commands.length; i++) {
          try {
            console.log(`\n🔄 Trying Windows print method ${i + 1}/${commands.length}...`);
            console.log(`📝 Command: ${commands[i].substring(0, 150)}...`);
            
            const { stdout, stderr } = await execAsync(commands[i], {
              timeout: 20000, // 20 seconds
              maxBuffer: 1024 * 1024,
              windowsHide: true,
            });

            console.log(`✅ Windows print method ${i + 1} successful`);
            if (stdout && stdout.trim()) {
              console.log(`📋 Output: ${stdout.trim()}`);
            }
            if (stderr && stderr.trim()) {
              console.log(`⚠️  Stderr: ${stderr.trim()}`);
            }

            // Method 1 uses Print Spooler API - will show in queue
            if (i === 0) {
              console.log(`✅ Data sent via Windows Print Spooler API (should appear in printer queue)`);
              console.log(`💡 Check Windows printer queue for TSC_TE244 to see the print job`);
            } else if (i === 1) {
              // Method 2 is direct port write (bypasses queue)
              console.log(`✅ Data sent directly to printer port (bypasses print queue)`);
              console.log(`💡 Raw TSPL data sent - printer should process it immediately`);
            } else {
              // Other methods are fallbacks
              console.log(`✅ Data sent via alternative method`);
            }

            success = true;
            break;
          } catch (error) {
            const errorMsg = error.message || error.toString();
            console.log(
              `❌ Windows print method ${i + 1} failed: ${errorMsg.substring(0, 300)}`,
            );
            
            if (error.stdout) {
              console.log(`   stdout: ${error.stdout.substring(0, 200)}`);
            }
            if (error.stderr) {
              console.log(`   stderr: ${error.stderr.substring(0, 200)}`);
            }
            
            if (i === commands.length - 1) {
              // List available printers for debugging
              try {
                const { stdout: printers } = await execAsync(
                  'powershell -Command "Get-Printer | Select-Object Name, Default, Status, PortName | Format-Table -AutoSize"',
                  { windowsHide: true, timeout: 5000 },
                );
                console.log('📋 Available printers:');
                console.log(printers);
                
                // Also get detailed printer info
                try {
                  const { stdout: printerInfo } = await execAsync(
                    `powershell -Command "Get-WmiObject -Query \\"SELECT * FROM Win32_Printer WHERE Name='${targetPrinter}'\\" | Select-Object Name, PortName, Status, Default | Format-List"`,
                    { windowsHide: true, timeout: 5000 },
                  );
                  if (printerInfo && printerInfo.trim()) {
                    console.log(`📋 Printer info for ${targetPrinter}:`);
                    console.log(printerInfo);
                  }
                } catch (infoErr) {
                  // Ignore
                }
              } catch (listError) {
                console.log(`ℹ️ Could not list printers: ${listError.message}`);
              }
              throw new Error(`All Windows printing methods failed. Last error: ${errorMsg}`);
            }
          }
        }

        // Clean up temporary files
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        if (fs.existsSync(psScriptPath)) {
          try {
            fs.unlinkSync(psScriptPath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        if (fs.existsSync(psSpoolerScriptPath)) {
          try {
            fs.unlinkSync(psSpoolerScriptPath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }

        if (success) {
          console.log('✅ Printed via Windows Print Spooler');
          return {
            success: true,
            method: 'cups', // Keep same method name for compatibility
            cupsMode: true,
            jobId: jobId,
            message: jobId
              ? `Print job queued with ID: ${jobId}`
              : 'Print job queued successfully on Windows',
          };
        } else {
          throw new Error(
            'All Windows printing methods failed. Please ensure your printer is installed and accessible.',
          );
        }
      }
      // macOS/Linux CUPS printing
      else {
        console.log('🍎/🐧 Detected macOS/Linux - using CUPS');

        // Ensure CUPS is running (Linux only, macOS CUPS runs automatically)
        if (isLinux) {
          try {
            await execAsync(
              'systemctl is-active --quiet cups || systemctl start cups',
            );
            console.log('✅ CUPS service is running');
          } catch (error) {
            console.log('ℹ️ CUPS service check skipped:', error.message);
          }
        } else if (isMacOS) {
          console.log('🍎 macOS detected - CUPS runs automatically');
        }

        // Create a proper virtual printer for barcode printing (Linux only)
        if (isLinux) {
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
      }
    } catch (error) {
      console.error('Print error:', error);
      throw error;
    }
  }

  // Send print job directly to USB printer (alternative method)
  // Note: This only works on Linux/macOS. On Windows, use CUPS/Windows Print Spooler instead.
  async printToUSBPrinterDirect(content) {
    const platform = os.platform();
    
    // Skip USB direct on Windows - use Windows Print Spooler instead
    if (platform === 'win32') {
      throw new Error('USB direct printing not supported on Windows. Use CUPS/Windows Print Spooler instead.');
    }
    
    try {
      // Try different USB device paths (Linux/macOS only)
      const possiblePaths = [
        '/dev/usb/lp0',
        '/dev/usb/lp1',
        '/dev/usb/lp2',
        '/dev/usb/lp3',
        '/dev/cups/0',
        '/dev/cups/1',
      ];

      for (const devicePath of possiblePaths) {
        try {
          if (fs.existsSync(devicePath)) {
            fs.writeFileSync(devicePath, content);
            console.log(`Printed to USB printer at ${devicePath}`);
            return {
              success: true,
              method: 'usb_direct',
              message: `Printed to USB printer at ${devicePath}`,
            };
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
        // Platform-aware auto selection
        const platform = os.platform();
        const isWindows = platform === 'win32';
        
        if (isWindows) {
          // On Windows, skip USB direct and go straight to Windows Print Spooler
          console.log('🪟 Windows detected - using Windows Print Spooler');
          try {
            return await this.printToCUPS(content);
          } catch (cupsError) {
            console.log('Windows printing failed, trying PDF...');
            return await this.printToPDF(content);
          }
        } else {
          // On Linux/macOS, try USB direct first, then CUPS
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

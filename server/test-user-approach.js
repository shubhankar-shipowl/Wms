/**
 * Test: User's original Tesseract approach on raw image
 */
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PDF_PATH = '/Users/shubhankarhaldar/Desktop/Wms/manifest - 2026-01-29T145424.413-20-21 (1)-2.pdf';

async function testUserApproach() {
  console.log('=== Testing User\'s Original Approach ===\n');
  
  const tempDir = '/tmp/user-approach-' + Date.now();
  fs.mkdirSync(tempDir, { recursive: true });
  
  // Convert PDF to PNG at very high resolution
  console.log('1. Converting PDF to 8000px PNG...');
  const outputPrefix = path.join(tempDir, 'page');
  execSync(`pdftocairo -png -f 1 -l 1 -scale-to 8000 "${PDF_PATH}" "${outputPrefix}"`, { stdio: 'pipe' });
  
  const pngFile = path.join(tempDir, 'page-1.png');
  console.log('   Created:', pngFile);
  
  // User's original code - recognize full image
  console.log('\n2. Running Tesseract on FULL IMAGE (User\'s method)...');
  const { data } = await Tesseract.recognize(pngFile, 'eng');
  const text = data.text.replace(/\n+/g, '\n');
  
  console.log('\n=== FULL OCR TEXT ===');
  console.log(text);
  console.log('=== END ===\n');
  
  // User's product extraction logic
  console.log('3. Extracting product using User\'s logic...');
  let productName = null;
  
  const itemBlock = text.match(/Item\s*description([\s\S]*?)\n\n/i);
  if (itemBlock) {
    console.log('   Found item block:', itemBlock[1].substring(0, 100));
    productName = itemBlock[1]
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 3 && !l.match(/qty|#|1/i)) || null;
  }
  
  // Fallback
  if (!productName) {
    console.log('   Trying fallback...');
    productName = text
      .split('\n')
      .find(line =>
        line.length > 5 &&
        !line.match(/awb|invoice|date|ship|gst|qty|cod|^\d+$/i) &&
        !line.match(/STVM|MSTA|MRJA|PTAF|amazon|shipping/i)
      ) || null;
  }
  
  // Courier
  let courierName = null;
  if (text.match(/amazon\s+shipping/i)) courierName = 'Amazon Shipping';
  else courierName = 'Unknown';
  
  console.log('\n=== FINAL RESULT ===');
  console.log('Product Name:', productName);
  console.log('Courier:', courierName);
  console.log('Temp files:', tempDir);
}

testUserApproach();

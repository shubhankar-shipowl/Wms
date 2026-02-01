const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { execSync } = require('child_process');

// Known couriers for matching
const KNOWN_COURIERS = [
  'XPRESSBEES', 'DELHIVERY', 'BLUEDART', 
  'DTDC', 'ECOM EXPRESS', 'FEDEX', 'DHL',
  'SHADOWFAX', 'EKART', 'INDIA POST', 
  'SPEED POST', 'GATI', 'PROFESSIONAL'
];

/**
 * Extract courier name from PDF label using OCR on the courier logo region
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<string>} - Detected courier name or empty string
 */
async function extractCourierFromImage(pdfPath) {
  // Region: Top Right 30% (Standard location for many courier logos, increased from 20%)
  const text = await extractTextFromRegion(pdfPath, {
    leftPercent: 0.5,
    topPercent: 0,
    widthPercent: 0.5,
    heightPercent: 0.3
  });

  return matchCourierName(text);
}

/**
 * Extract Store/Brand name from PDF label using OCR
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<string>} - Detected store name
 */
async function extractStoreFromImage(pdfPath) {
  // Region: Top Right 20% (Same as courier usually, but we treat result differently)
  // ShoppersKart logo is top right.
  const text = await extractTextFromRegion(pdfPath, {
    leftPercent: 0.5,
    topPercent: 0,
    widthPercent: 0.5,
    heightPercent: 0.2
  });
  
  if (!text) return '';

  // Clean the text
  // 1. Remove known couriers (we don't want to mistake courier for store)
  const courier = matchCourierName(text);
  if (courier) {
    // If exact match of a courier name, likely it IS the courier logo, not store
    // unless the store name contains the courier name (rare)
    return '';
  }

  // 2. Remove common label words
  let cleanText = text
    .replace(/\b(To|From|Ship|Bill|Date|Invoice|Order|No|COD|Prepaid|Standard|Express)\b/gi, '')
    .trim();
    
  // 3. Remove non-word characters from ends
  cleanText = cleanText.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  
  // 4. Split lines and take the most prominent one (likely brand name)
  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  
  if (lines.length > 0) {
    // Return the longest line usually? Or the first?
    // Start with first line that looks like a name
    for (const line of lines) {
       // Filter out garbage OCR
       if (/^[a-zA-Z0-9\s&'-]+$/.test(line)) {
         // Fix: Remove leading numbers (often barcode artifacts like "70 DAZARA")
         // e.g., "70 DAZARA" -> "DAZARA"
         const cleanedLine = line.replace(/^\d+\s*/, '').trim();
         
         if (cleanedLine.length > 2) {
             return cleanedLine;
         }
       }
    }
  }

  return '';
}

/**
 * Core function to extract text from a specific region of the PDF
 */
async function extractTextFromRegion(pdfPath, region) {
  const tempDir = path.join(path.dirname(pdfPath), 'ocr-temp-' + Date.now());
  
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 1. Convert PDF to image
    const outputPrefix = path.join(tempDir, 'page');
    try {
      // Increased scale to 3000 for better OCR accuracy on small text
      execSync(`pdftocairo -png -f 1 -l 1 -scale-to 3000 "${pdfPath}" "${outputPrefix}"`, {
        stdio: 'pipe'
      });
    } catch (cmdError) {
      console.error('pdftocairo command failed:', cmdError.message);
      cleanupTempFiles(tempDir);
      return '';
    }

    const files = fs.readdirSync(tempDir);
    const pngFile = files.find(f => f.startsWith('page') && f.endsWith('.png'));
    
    if (!pngFile) {
      cleanupTempFiles(tempDir);
      return '';
    }

    const imagePath = path.join(tempDir, pngFile);

    // 2. Crop
    const metadata = await sharp(imagePath).metadata();
    const { width, height } = metadata;

    const left = Math.floor(width * region.leftPercent);
    const top = Math.floor(height * region.topPercent);
    const cropWidth = Math.floor(width * region.widthPercent);
    const cropHeight = Math.floor(height * region.heightPercent);

    const cropBuffer = await sharp(imagePath)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .grayscale()
      .normalize() 
      .sharpen() // Enhance edges
      .toBuffer();

    // 3. OCR (PSM 6 = Assume a single uniform block of text)
    const { data: { text } } = await Tesseract.recognize(
      cropBuffer,
      'eng',
      { 
        logger: m => {},
        tessedit_pageseg_mode: '6'
      }
    );

    cleanupTempFiles(tempDir);
    return text;

  } catch (error) {
    console.error('OCR region extraction error:', error);
    if (fs.existsSync(tempDir)) cleanupTempFiles(tempDir);
    return '';
  }
}

/**
 * Match OCR text against known courier names
 * @param {string} ocrText - Raw OCR text
 * @returns {string} - Matched courier name or empty string
 */
function matchCourierName(ocrText) {
  if (!ocrText) return '';
  
  // Clean up symbols that might confuse matching (like logo graphics ">>>", "_", "-")
  const textUpper = ocrText.toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ') // Replace non-alphanumeric with space
    .replace(/\s+/g, ' ')
    .trim();

  // Create a condensed version (no spaces) to catch "X P R E S S B E E S"
  const textCondensed = textUpper.replace(/\s+/g, '');
  
  for (const courier of KNOWN_COURIERS) {
    // Check both standard (spaced) and condensed versions
    if (textUpper.includes(courier) || textCondensed.includes(courier)) {
      return courier.charAt(0) + courier.slice(1).toLowerCase();
    }
  }
  
  if (textUpper.includes('XPRESS') || textUpper.includes('BEES')) return 'Xpressbees';
  if (textCondensed.includes('XPRESS') && textCondensed.includes('BEES')) return 'Xpressbees'; // Catch splitted
  
  if (textUpper.includes('DELH') || textUpper.includes('VERY')) return 'Delhivery';
  if (textUpper.includes('BLUE') || textUpper.includes('DART')) return 'BlueDart';
  if (textUpper.includes('KART') && !textUpper.includes('SHOPPERS')) return 'Ekart'; // Ensure we don't match ShoppersKart as Ekart if Kart is present
  
  return '';
}

/**
 * Cleanup temporary OCR files
 */
function cleanupTempFiles(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => fs.unlinkSync(path.join(tempDir, file)));
      fs.rmdirSync(tempDir);
    }
  } catch (e) {
    console.error('OCR cleanup error:', e);
  }
}

module.exports = {
  extractCourierFromImage,
  extractStoreFromImage,
  matchCourierName,
  extractTextFromRegion
};

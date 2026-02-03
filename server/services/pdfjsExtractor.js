/**
 * PDF.js Text Extraction Service
 * Uses PDF.js to extract text with font information from PDFs
 * This is particularly useful for PDFs where OCR fails due to embedded fonts
 */
const fs = require('fs');
const path = require('path');

// PDF.js setup for Node.js environment
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Disable worker for Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

/**
 * Extract text from PDF using PDF.js
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<string>} - Extracted text content
 */
async function extractTextWithPdfJs(pdfPath) {
  try {
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    // Process each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Extract text items and join them
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      
      fullText += pageText + '\n';
    }
    
    return fullText;
  } catch (error) {
    console.error('[PDF.js] Error extracting text:', error);
    return '';
  }
}

/**
 * Extract text with line structure preserved
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<string>} - Extracted text with line breaks
 */
async function extractTextWithLines(pdfPath) {
  try {
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Group text items by their Y position to reconstruct lines
      const items = textContent.items;
      if (items.length === 0) continue;
      
      // Sort by Y position (top to bottom), then X position (left to right)
      items.sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5]; // Y is inverted in PDF coords
        if (Math.abs(yDiff) > 5) return yDiff; // Different lines
        return a.transform[4] - b.transform[4]; // Same line, sort by X
      });
      
      let currentY = null;
      let currentLine = '';
      
      for (const item of items) {
        const y = Math.round(item.transform[5]);
        
        if (currentY === null) {
          currentY = y;
          currentLine = item.str;
        } else if (Math.abs(y - currentY) > 5) {
          // New line
          fullText += currentLine.trim() + '\n';
          currentY = y;
          currentLine = item.str;
        } else {
          // Same line
          currentLine += ' ' + item.str;
        }
      }
      
      // Add last line
      if (currentLine) {
        fullText += currentLine.trim() + '\n';
      }
    }
    
    return fullText;
  } catch (error) {
    console.error('[PDF.js] Error extracting text with lines:', error);
    return '';
  }
}

/**
 * Extract Amazon product from PDF using PDF.js
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<{products: Array, courier_name: string}>}
 */
async function extractAmazonWithPdfJs(pdfPath) {
  console.log('[PDF.js] Starting extraction for:', pdfPath);
  
  const text = await extractTextWithLines(pdfPath);
  console.log('[PDF.js] Extracted text length:', text.length);
  console.log('[PDF.js] Text sample:', text.substring(0, 500));
  
  const products = [];
  
  // Look for "Item description" block
  const itemBlock = text.match(/Item\s*description([\s\S]*?)(\n\n|STVM|amazon|$)/i);
  
  if (itemBlock) {
    console.log('[PDF.js] Found item block');
    const lines = itemBlock[1].split('\n').map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
      // Skip header/noise
      if (line.match(/^#|^\d+$/i)) continue;
      if (line.length < 4) continue;
      if (/STVM|MSTA|MRJA|PTAF|amazon|shipping/i.test(line)) continue;
      
      // Extract product name
      let name = line.replace(/^\d+\s+/, '').trim();
      name = name.replace(/\s*QTY\s*[-–—:]\s*\d+.*$/i, '').trim();
      
      if (name && name.length > 3) {
        const qtyMatch = line.match(/QTY\s*[-–—:]\s*(\d+)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        
        console.log('[PDF.js] Found product:', name, 'Qty:', qty);
        products.push({ product_name: name, quantity: qty, price: 0 });
      }
    }
  }
  
  // Fallback: Look for QTY pattern anywhere
  if (products.length === 0) {
    console.log('[PDF.js] Trying QTY pattern fallback...');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
      if (/STVM|MSTA|MRJA|PTAF|amazon|shipping/i.test(line)) continue;
      
      const qtyMatch = line.match(/(.+?)\s*QTY\s*[-–—:]\s*(\d+)/i);
      if (qtyMatch) {
        let name = qtyMatch[1].replace(/^\d+\s+/, '').trim();
        if (name && name.length > 3) {
          console.log('[PDF.js Fallback] Found product:', name);
          products.push({ product_name: name, quantity: parseInt(qtyMatch[2]), price: 0 });
        }
      }
    }
  }
  
  // Detect courier
  let courier_name = '';
  if (/amazon\s*shipping/i.test(text)) {
    courier_name = 'Amazon Shipping';
  }
  
  return { products, courier_name };
}

module.exports = {
  extractTextWithPdfJs,
  extractTextWithLines,
  extractAmazonWithPdfJs
};

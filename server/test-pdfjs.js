/**
 * Test PDF.js extraction on Amazon label
 */
const { extractTextWithLines, extractAmazonWithPdfJs } = require('./services/pdfjsExtractor');

const PDF_PATH = '/Users/shubhankarhaldar/Desktop/Wms/manifest - 2026-01-29T145424.413-20-21 (1)-2.pdf';

async function testPdfJs() {
  console.log('=== Testing PDF.js Extraction ===\n');
  
  // Extract raw text
  console.log('1. Extracting text with PDF.js...\n');
  const text = await extractTextWithLines(PDF_PATH);
  console.log('=== RAW TEXT ===');
  console.log(text);
  console.log('=== END ===\n');
  
  // Extract products
  console.log('2. Extracting Amazon products...\n');
  const result = await extractAmazonWithPdfJs(PDF_PATH);
  
  console.log('\n=== FINAL RESULT ===');
  console.log('Courier:', result.courier_name);
  console.log('Products:', result.products);
}

testPdfJs();

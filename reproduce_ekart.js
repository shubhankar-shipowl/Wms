
const { extractProducts } = require('./server/services/pdfExtractor');

// Mock text variants based on potential OCR output for the EKART label
const mockText1 = `
Shopperskart
148101
Shipping Address
Reshma Khan
Note: 6824320663772
Product Price Qty
Revolving Spice Rack Pack of 16 1999.00 1
Total 1999.00
6824320663772 EKART
`;

const mockText2 = `
Shopperskart
Product Price Qty
Revolving Spice Rack Pack of 1999.00 1
16
Total 1999.00
EKART
`;

const mockText3 = `
Shopperskart
Product Price Qty
Revolving Spice Rack Pack of 16
1999.00 1
Total 1999.00
EKART
`;

function testExtraction(text, name) {
  console.log(`--- Testing ${name} ---`);
  // We need to implement the logic here first or mock the extractProducts to use the NEW logic
  // BUT extractProducts is imported from value.
  // So I will simulate the logic I WANT to add here, then copy it to the file.
  
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const products = [];
  
  // New Logic Proposal:
  let headerIndex = -1;
  let accumulatedName = [];

  for(let i=0; i<lines.length; i++) {
    // Check for "Product Price Qty" header pattern
    if (lines[i].match(/Product/i) && lines[i].match(/Price/i) && lines[i].match(/Qty/i)) {
      headerIndex = i;
      
      for (let j = i + 1; j < lines.length; j++) {
         const line = lines[j];
         if (line.match(/Total|Subtotal/i) || line.match(/^EKART/i)) break;
         if (line.length < 2) continue;

         // Check for Price + Qty at end of line
         // Regex: (Price) (Qty)
         const priceQtyMatch = line.match(/(\d+\.\d{2})\s+(\d+)$/);
         
         if (priceQtyMatch) {
             const price = parseFloat(priceQtyMatch[1]);
             const qty = parseInt(priceQtyMatch[2]);
             
             // Get the name part from this line (if any)
             const namePart = line.replace(/(\d+\.\d{2})\s+(\d+)$/, '').trim();
             
             if (namePart) {
                 accumulatedName.push(namePart);
             }
             
             if (accumulatedName.length > 0) {
                 products.push({
                     product_name: accumulatedName.join(' ').trim(),
                     price: price,
                     quantity: qty
                 });
                 accumulatedName = []; // Reset
             }
         } else {
             // Treat as part of name if not garbage
             // Verify it's not some other invoice details?
             accumulatedName.push(line);
         }
      }
      break;
    }
  }
  
  console.log("Extracted:", products);
}

testExtraction(mockText1, "Variant 1 (Single Line)");
testExtraction(mockText2, "Variant 2 (Split)"); 
testExtraction(mockText3, "Variant 3 (Split)"); 

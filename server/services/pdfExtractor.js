const pdfParseModule = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const { extractCourierFromImage, extractStoreFromImage, extractTextFromRegion, extractLabelDataFromPdf } = require('./ocrExtractor');

/**
 * Extract metadata from PDF label
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<{brand_name: string, courier_company: string, product_name: string}>}
 */
async function extractLabelMetadata(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    
    // pdf-parse: PDFParse is a class that needs to be instantiated
    if (!pdfParseModule.PDFParse || typeof pdfParseModule.PDFParse !== 'function') {
      throw new Error('PDFParse class not found in pdf-parse module');
    }
    
    // Instantiate PDFParse with the data buffer
    const parser = new pdfParseModule.PDFParse({ data: dataBuffer });
    
    // Get text from PDF
    const textData = await parser.getText();
    let text = textData.text || '';
    
    // Clean up
    await parser.destroy();

    // GLOBAL OCR FALLBACK
    // If text is empty or garbage, implies image-based PDF.
    // Convert entire PDF to text via OCR so all subsequent regex functions works.
    if (!text || text.trim().length < 50) {
      console.log('PDF text is empty (Image-based PDF detected). Running full-page OCR...');
      try {
        // Scan full page (0,0,1,1)
        const ocrText = await extractTextFromRegion(filePath, { 
          leftPercent: 0, topPercent: 0, widthPercent: 1, heightPercent: 1 
        });
        
        if (ocrText && ocrText.length > 50) {
           text = ocrText;
           console.log('Full-page OCR successful. Text length:', text.length);
        } else {
           console.log('Full-page OCR returned little/no text.');
        }
      } catch (ocrErr) {
        console.error('Full-page OCR fallback failed:', ocrErr);
      }
    }
    
    // DEBUG: Write raw text to file to analyze layout issues or OCR results
    try {
      fs.writeFileSync(path.join(path.dirname(filePath), 'debug_pdf_text.txt'), text);
    } catch (e) {
      console.error('Failed to write debug text', e);
    }

    // Extract brand/store name - try multiple strategies in order of reliability
    // 1. Amazon "Ordered From:" (most specific for Amazon labels)
    let brandName = extractAmazonBrand(text);
    // 2. Known brand keyword search across entire label text (most consistent display names)
    if (!brandName) {
      brandName = extractKnownBrand(text);
    }
    // 3. Email-based extraction (reliable for Flipkart/Ekart labels with support email)
    if (!brandName) {
      brandName = extractBrandFromEmail(text);
    }
    // 4. Invoice No prefix detection (e.g. "#SK" -> "SHOPPERS KART")
    if (!brandName) {
      brandName = extractBrandFromInvoice(text);
    }
    // 5. General brand extraction from first lines (Delhivery-style labels)
    if (!brandName) {
      brandName = extractBrandName(text);
    }
    // 6. OCR on top logo area (for labels with brand as image logo)
    if (!brandName) {
      try {
        const ocrBrand = await extractStoreFromImage(filePath);
        if (ocrBrand) {
          console.log('OCR detected store/brand:', ocrBrand);
          brandName = ocrBrand;
        }
      } catch (ocrErr) {
        console.error('Brand OCR fallback failed:', ocrErr.message);
      }
    }

    // Extract customer/recipient name from "Ship To" / "Deliver To" section
    const customerName = extractCustomerName(text);

    // Extract courier company (usually at the top, right side)
    let courierCompany = extractCourierCompany(text);
    
    // If courier not found via text extraction, try OCR on the logo image
    if (!courierCompany) {
      console.log('Text extraction failed for courier, trying OCR...');
      try {
        courierCompany = await extractCourierFromImage(filePath);
        if (courierCompany) {
          console.log('OCR detected courier:', courierCompany);
        }
      } catch (ocrError) {
        console.error('OCR fallback failed:', ocrError);
      }
    }

    // Extract product name (usually in product details section)
    let products = extractProducts(text); // extractProducts returns array

    // AMAZON SPECIFIC OVERRIDE
    // If it's Amazon Shipping, prefer the advanced pixel-projection OCR immediately
    // because text layer is often garbage or missing for product name.
    if (courierCompany === 'Amazon Shipping') {
        console.log('Amazon Shipping detected. Attempting Advanced Pixel-Projection OCR...');
        try {
            const advancedData = await extractLabelDataFromPdf(filePath);
            if (advancedData.products && advancedData.products.length > 0) {
                console.log('Advanced OCR Success (Primary):', advancedData.products.length, 'products found.');
                // Prioritize this result over text extraction
                products = advancedData.products;
            } else {
                console.log('Advanced OCR failed, falling back to text extraction results.');
            }
        } catch (e) {
            console.error('Advanced OCR Primary check failed:', e);
        }
    }

    // FALLBACK: If no products found via text parser, try Advanced Region-Based OCR
    if (products.length === 0) {
        console.log('Product extraction failed via text parser. Attempting Advanced Region OCR...');
        try {
            const advancedData = await extractLabelDataFromPdf(filePath);
            
            if (advancedData.products && advancedData.products.length > 0) {
                console.log('Advanced OCR Success:', advancedData.products.length, 'products found.');
                products = advancedData.products;
                
                // If courier was also unknown, update it
                if ((!courierCompany || courierCompany === 'Unknown Courier') && advancedData.courier_name) {
                    courierCompany = advancedData.courier_name;
                }
            } else {
                 console.log('Advanced OCR also failed to find products.');
            }
        } catch (e) {
            console.error('Advanced OCR fallback failed:', e);
        }
    }

    let productName = '';
    
    // Fallback for single product name (legacy support)
    if (products.length > 0) {
      productName = products[0].product_name;
    } else {
      productName = extractProductName(text); // Legacy function
      
      // CRITICAL: Filter out known garbage patterns from legacy extraction
      if (productName && /STVM|MSTA|MRJA|PTAF|amazon\s*shipping|M1B|F17|^pE[—\-_]*T?$/i.test(productName)) {
        console.log('[Legacy Fallback] Garbage detected, clearing product name:', productName);
        productName = '';  // Clear garbage
      }
      
      // Also filter very short or garbage-like names
      if (productName && (productName.length < 4 || /^[^a-zA-Z]*$/.test(productName))) {
        console.log('[Legacy Fallback] Invalid product name, clearing:', productName);
        productName = '';
      }
    }

    // Extract Order Number / AWB for duplicate validation
    const orderNumber = extractOrderNumber(text, courierCompany);

    return {
      brand_name: brandName,
      courier_company: courierCompany || '',
      product_name: productName || '',
      products: products, // Pass full products array
      order_number: orderNumber || '',
      customer_name: customerName || ''
    };
  } catch (error) {
    console.error('Error extracting PDF metadata:', error);
    return {
      brand_name: '',
      courier_company: '',
      product_name: '',
      products: [],
      customer_name: ''
    };
  }
}

function extractAmazonBrand(text) {
  const lines = text.split('\n').map(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    // Check for "Ordered From:" header
    const match = lines[i].match(/^Ordered From:?(.*)/i);
    if (match) {
      let candidate = '';
      
      // Case 1: Value on same line "Ordered From: Shopperskart"
      if (match[1] && match[1].trim().length > 1) {
        candidate = match[1].trim();
      }
      // Case 2: Value on next line
      else if (lines[i+1]) {
        candidate = lines[i+1];
      }
      
      if (candidate) {
        // Clean up common OCR artifacts
        // "Shopperskart pi -" -> "Shopperskart"
        // "Shopperskart aa ~" -> "Shopperskart"
        // "Shopperskart a I" -> "Shopperskart"
        // Remove trailing single/double letter noise + any following chars
        candidate = candidate.replace(/\s+(pi|aa)\s*[-~]?.*$/i, '');
        candidate = candidate.replace(/\s+[a-zA-Z]{1,2}\s+[a-zA-Z]{1,2}\s*$/, ''); // " a I", " a i"
        candidate = candidate.replace(/\s+[a-zA-Z]{1,2}\s*[-~=|]?\s*$/, ''); // trailing single letter + symbol
        candidate = candidate.replace(/\s+[-~=|]\s*$/, '');

        // Remove trailing non-alphanumeric chars (except .)
        candidate = candidate.replace(/[^a-zA-Z0-9.]+$/, '');

        if (candidate.trim().length >= 3) {
          return candidate.trim();
        }
      }
    }
  }
  return '';
}

/**
 * Extract brand name from Email address in the text
 * Looks for pattern like "Email: support@brandname.com"
 */
function extractBrandFromEmail(text) {
  // Look for email pattern, capturing the domain part
  // Matches: support@shopperskart.shop -> shopperskart
  const emailMatch = text.match(/Email:\s*([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/i) ||
                     text.match(/\b([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))\b/i);
  
  if (emailMatch) {
    const fullEmail = emailMatch[1];
    const domain = emailMatch[2]; 
    
    // Ignore common generic domains if any (e.g. gmail.com) - though businesses usually match
    if (domain.match(/gmail\.com|yahoo\.com|outlook\.com|hotmail\.com/i)) return '';
    
    // Get the first part of the domain (e.g. shopperskart from shopperskart.shop)
    const storeName = domain.split('.')[0]; 
    
    // Capitalize first letter (Shopperskart)
    // You might want to match it against a known list or just capitalize
    return storeName.charAt(0).toUpperCase() + storeName.slice(1);
  }
  return '';
}

/**
 * Search entire label text for known brand names/keywords.
 * This catches brands mentioned anywhere (email footers, support text, etc.)
 */
function extractKnownBrand(text) {
  const textLower = text.toLowerCase();

  // Known brand keywords -> display name
  const knownBrands = [
    { keywords: ['shopperskart', 'shoppers kart', 'shoppers  kart'], name: 'SHOPPERS KART' },
    { keywords: ['dazara'], name: 'DAZARA' },
    { keywords: ['zen goods', 'zengoods'], name: 'ZEN GOODS' },
    { keywords: ['liveonease', 'live on ease'], name: 'LiveOnEase' },
  ];

  for (const brand of knownBrands) {
    for (const keyword of brand.keywords) {
      if (textLower.includes(keyword)) {
        console.log(`[Brand] Known brand found via keyword "${keyword}": ${brand.name}`);
        return brand.name;
      }
    }
  }
  return '';
}

/**
 * Extract brand name from Invoice Number prefix.
 * e.g. Invoice No: #SK671079 -> "SHOPPERS KART" (SK prefix)
 */
function extractBrandFromInvoice(text) {
  const invoiceMatch = text.match(/Invoice\s*No[:\s]*#?([A-Z]{2,4})\d+/i);
  if (!invoiceMatch) return '';

  const prefix = invoiceMatch[1].toUpperCase();

  // Known invoice prefix -> brand mapping
  const prefixMap = {
    'SK': 'SHOPPERS KART',
    'ZG': 'ZEN GOODS',
    'DZ': 'DAZARA',
    'LO': 'LiveOnEase',
  };

  return prefixMap[prefix] || '';
}

/**
 * Extract brand name from PDF text
 * Appears in the TOP LEFT box - appears on line 2 (after warehouse code on line 1)
 * Handles multi-line brand names like "SHOPPERS" on line 1 and "KART" on line 2
 */
function extractBrandName(text) {
  // Split text into lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  // Detect Ekart/Flipkart label format: first line is "PIN DATE" (e.g. "603209 01/02/2026")
  // followed by "Shipping Address". These labels have brand as IMAGE logo, not in text.
  // Text-based extraction here would only pick up address garbage, so skip entirely.
  if (lines.length > 1 &&
      lines[0].match(/^\d{6}\s+\d{2}\/\d{2}\/\d{4}/) &&
      lines.some((l, i) => i < 3 && /Shipping\s*Address/i.test(l))) {
    return '';
  }

  const knownCouriers = [
    'delhivery', 'fedex', 'dhl', 'bluedart', 'blue dart', 'dtdc',
    'ecom express', 'ecom express', 'xpressbees', 'xpress bees',
    'shiprocket', 'ship rocket', 'pickrr', 'ekart', 'e kart',
    'india post', 'speed post', 'first flight', 'professional', 'gati', 'surface'
  ];

  // Indian states/UTs and common location words that should NOT be brand names
  const knownLocations = [
    'punjab', 'haryana', 'rajasthan', 'maharashtra', 'gujarat', 'bihar',
    'karnataka', 'kerala', 'telangana', 'andhra pradesh', 'tamil nadu',
    'uttar pradesh', 'madhya pradesh', 'west bengal', 'odisha', 'assam',
    'jharkhand', 'chhattisgarh', 'uttarakhand', 'himachal pradesh', 'goa',
    'tripura', 'meghalaya', 'manipur', 'nagaland', 'mizoram', 'arunachal pradesh',
    'sikkim', 'delhi', 'chandigarh', 'jammu', 'kashmir', 'ladakh',
    'mumbai', 'kolkata', 'chennai', 'bangalore', 'hyderabad', 'pune', 'jaipur',
    'lucknow', 'ahmedabad', 'surat', 'indore', 'bhopal', 'patna', 'india'
  ];

  // Address/locality words that should never be a brand name
  const addressWords = new Set([
    'station', 'railway', 'masjid', 'nagar', 'road', 'street', 'lane', 'colony', 'building',
    'apartment', 'flat', 'house', 'floor', 'block', 'sector', 'plot', 'near',
    'opposite', 'behind', 'village', 'town', 'city', 'district', 'tehsil',
    'chowk', 'bazaar', 'market', 'gali', 'mohalla', 'ward', 'post', 'office',
    'temple', 'church', 'mosque', 'school', 'college', 'hospital', 'park',
    'garden', 'tower', 'complex', 'enclave', 'vihar', 'puram', 'abad',
    'centre', 'center', 'tiffin', 'resort', 'stop', 'bus', 'ghat',
    'address', 'shipping', 'deliver', 'invoice', 'order', 'product', 'price',
    'total', 'weight', 'dimensions', 'please', 'reach', 'complaints',
    'great', 'placed', 'barcode', 'sunti', 'kumar', 'singh', 'sharma',
    'nath', 'das', 'devi', 'ram', 'lal', 'prasad', 'lakshmi', 'gour',
    'mali', 'karan', 'charan'
  ]);

  // Helper function to check if a line is a potential brand name part
  const isBrandNamePart = (line) => {
    if (!line || line.length < 2) return false;

    // Skip Indian states/locations
    if (knownLocations.includes(line.toLowerCase())) return false;

    // Skip warehouse codes in parentheses like "(BWR/RIA)", "(JAI/JAI)", etc.
    if (line.match(/^\([A-Z]{3}\/[A-Z]{3}\)$/)) return false;

    // Skip barcodes (long numeric strings, usually 13+ digits)
    if (line.match(/^\d{13,}$/)) return false;

    // Skip known non-brand keywords
    // Added 'TO', 'FROM' to explicitly skip
    if (line.match(/^(COD|PIN|SKU|QTY|DATE|ORDER|INVOICE|TOTAL|PRICE|RS|ADDRESS|DELIVER|TO\b|FROM\b|NUMBER|VALUE)$/i)) return false;
    if (line.match(/^To\s*:/i) || line.match(/^From\s*:/i)) return false;
    if (line.match(/^Shipping\s*Address/i) || line.match(/^Ship\s*To/i)) return false;

    // Check if it's a courier (should not extract courier as brand)
    const lineLower = line.toLowerCase();
    if (knownCouriers.some(courier => lineLower === courier || lineLower.startsWith(courier + ' '))) {
      return false;
    }

    // Skip if ALL words are address/locality words (e.g. "Sunti Masjid", "Station Road")
    const words = lineLower.split(/\s+/).filter(w => w.length > 1);
    if (words.length > 0 && words.every(w => addressWords.has(w))) {
      return false;
    }

    // Brand name parts are typically:
    // - Uppercase letters (may have spaces)
    // - Length between 2-30 characters
    if (line.length >= 2 && line.length <= 30 && line.match(/^[A-Za-z\s&'-]+$/)) {
      return true;
    }

    return false;
  };
  
  // Collect potential brand name parts from first few lines
  let brandNameParts = [];
  let skipNextLine = false; 
  
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const line = lines[i];
    
    // Check if line indicates next line is a customer name (e.g., "To:", "Shipping Address")
    if (line.match(/^(To|Ship\s*To|Shipping\s*Address)[\s:]*/i) || line.trim().toLowerCase() === 'to' || line.trim().toLowerCase() === 'to:') {
      skipNextLine = true;
      continue;
    }

    if (skipNextLine) {
      skipNextLine = false;
      continue; // Skip this line (likely Customer Name "Amar Singh")
    }

    // Skip empty or very short lines
    if (line.length < 2) continue;
    
    // Skip warehouse codes
    if (line.match(/^\([A-Z]{3}\/[A-Z]{3}\)$/)) continue;
    
    // Skip barcodes
    if (line.match(/^\d{13,}$/)) continue;
    
    // Check if line has large gaps (multiple spaces) - might be "Brand      Courier"
    if (line.includes('   ')) {
      const parts = line.split(/\s{3,}/);
      const firstPart = parts[0].trim();
      // If first part is valid brand text, use it
      if (isBrandNamePart(firstPart) && 
          !knownCouriers.some(c => firstPart.toLowerCase() === c || firstPart.toLowerCase().startsWith(c + ' '))) {
        brandNameParts.push(firstPart);
        break; // If we find spaced format, brand is complete
      }
    }
    
    // Check if this line is a potential brand name part
    if (isBrandNamePart(line)) {
      const lineLower = line.toLowerCase();
      
      // Check if it's a courier - if so, stop collecting brand parts
      if (knownCouriers.some(courier => lineLower === courier || lineLower.startsWith(courier + ' '))) {
        break;
      }
      
      // Add to brand name parts
      brandNameParts.push(line);
      
      // Check if we have a complete brand name (common patterns)
      const currentBrand = brandNameParts.join(' ');
      
      // If brand contains common suffixes, it might be complete
      if (currentBrand.match(/\b(GOODS|BRAND|STORE|SHOP|MART|KART|INC|LLC|LTD)$/i)) {
        break; // Brand name is complete
      }
      
      // If we have 2-4 words, check if it looks like a complete brand
      if (brandNameParts.length >= 2 && brandNameParts.length <= 4) {
        // Continue collecting unless next line is clearly not part of brand
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          // If next line is a courier, barcode, or keyword, stop
          if (nextLine.match(/^\d{13,}$/) ||
              nextLine.match(/^(COD|PIN|SKU|QTY|DATE|ORDER)/i) ||
              knownCouriers.some(c => nextLine.toLowerCase() === c)) {
            break;
          }
        }
      }
      
      // Limit to 4 parts maximum
      if (brandNameParts.length >= 4) break;
    } else {
      // If we already have some brand parts and hit a non-brand line, stop
      if (brandNameParts.length > 0) {
        break;
      }
    }
  }
  
  // Join collected parts
  if (brandNameParts.length > 0) {
    const brandName = brandNameParts.join(' ').trim();
    // Final validation - should be reasonable length
    if (brandName.length >= 3 && brandName.length <= 50) {
      return brandName;
    }
  }
  
  return '';
}

/**
 * Extract customer/recipient name from shipping label text.
 * Looks for "Ship To:", "Deliver To:", "To:" sections and grabs the name line.
 */
function extractCustomerName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Patterns that indicate the next line(s) contain the recipient name
  const shipToPatterns = [
    /^(?:Ship\s*To|Deliver\s*To|Delivery\s*Address|Shipping\s*Address|Consignee)\s*:?\s*$/i,
    /^To\s*:?\s*$/i,
  ];

  // Patterns where name is on the SAME line: "Ship To: John Smith"
  const inlinePatterns = [
    /^(?:Ship\s*To|Deliver\s*To|Consignee)\s*:\s*(.+)/i,
    /^To\s*:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  ];

  // Try inline patterns first - if inline value is valid, use it; otherwise check next lines
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of inlinePatterns) {
      const match = lines[i].match(pattern);
      if (match && match[1]) {
        const candidate = cleanCustomerName(match[1].trim());
        if (candidate) return candidate;
        // Inline value was garbage (e.g. "Ship To: 31/01") - check next lines for the actual name
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextCandidate = cleanCustomerName(lines[j]);
          if (nextCandidate) return nextCandidate;
        }
      }
    }
  }

  // Try "header on one line, name on next line" pattern
  for (let i = 0; i < lines.length - 1; i++) {
    for (const pattern of shipToPatterns) {
      if (pattern.test(lines[i])) {
        // The next non-empty line should be the customer name
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const candidate = cleanCustomerName(lines[j]);
          if (candidate) return candidate;
        }
      }
    }
  }

  // Fallback: look for "Customer Name:" or "Name:" pattern
  for (const line of lines) {
    const nameMatch = line.match(/(?:Customer\s*Name|Recipient|Buyer)\s*:\s*(.+)/i);
    if (nameMatch && nameMatch[1]) {
      const candidate = cleanCustomerName(nameMatch[1].trim());
      if (candidate) return candidate;
    }
  }

  return '';
}

/**
 * Clean and validate a customer name candidate
 */
function cleanCustomerName(text) {
  if (!text || text.length < 2) return '';

  // Remove leading/trailing non-alpha chars
  let name = text.replace(/^[^a-zA-Z]+/, '').replace(/[^a-zA-Z.\s]+$/, '').trim();

  // Skip if it looks like an address (contains numbers, pin codes, etc.)
  if (/\d{5,}/.test(name)) return '';
  if (/pin\s*code/i.test(name)) return '';

  // Skip known non-name patterns
  if (/^(COD|PIN|SKU|QTY|DATE|ORDER|INVOICE|TOTAL|PRICE|ADDRESS|PHONE|MOBILE|EMAIL)/i.test(name)) return '';

  // Skip if too short or too long for a name
  if (name.length < 2 || name.length > 60) return '';

  // Take only the name part (stop at comma or known address keywords)
  name = name.split(/[,\n]/)[0].trim();
  name = name.replace(/\s+(House|Floor|Flat|Block|Street|Road|Lane|Sector|Plot|Near|Opp|Behind|Village|Dist|Tehsil|PO|Post).*/i, '').trim();

  // Validate: should contain at least one letter
  if (!/[a-zA-Z]/.test(name)) return '';

  // Title case the name
  name = name.split(/\s+/).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');

  return name.length >= 2 ? name : '';
}

/**
 * Extract courier company from PDF text
 * Appears in the TOP RIGHT box
 */
function extractCourierCompany(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  const courierPatterns = [
    { pattern: /DELHIVERY/i, name: 'Delhivery' },
    { pattern: /DELHIV/i, name: 'Delhivery' },  // Partial match
    { pattern: /FEDEX/i, name: 'FedEx' },
    { pattern: /DHL/i, name: 'DHL' },
    { pattern: /BLUE\s*DART/i, name: 'Blue Dart' },
    { pattern: /DTDC/i, name: 'DTDC' },
    { pattern: /ECOM\s*EXPRESS/i, name: 'Ecom Express' },
    { pattern: /XPRESS\s*BEES/i, name: 'Xpressbees' },
    { pattern: /XPRESSBEES/i, name: 'Xpressbees' },
    { pattern: /XYXPRESSEBEES/i, name: 'Xpressbees' }, // OCR artifact
    { pattern: /PRESSEBEES/i, name: 'Xpressbees' },
    { pattern: />>XPRESS/i, name: 'Xpressbees' },
    { pattern: /SHIP\s*ROCKET/i, name: 'Shiprocket' },
    { pattern: /SHIPROCKET/i, name: 'Shiprocket' },
    { pattern: /PICKRR/i, name: 'Pickrr' },
    { pattern: /EKART/i, name: 'Ekart' },
    { pattern: /E\s*KART/i, name: 'Ekart' },
    { pattern: /INDIA\s*POST/i, name: 'India Post' },
    { pattern: /SPEED\s*POST/i, name: 'Speed Post' },
    { pattern: /FIRST\s*FLIGHT/i, name: 'First Flight' },
    { pattern: /PROFESSIONAL/i, name: 'Professional' },
    { pattern: /SURFACE/i, name: 'Surface' },
    { pattern: /AMAZON\s*SHIPPING/i, name: 'Amazon Shipping' },
    { pattern: /AMAZON\s*TRANSPORT/i, name: 'Amazon Shipping' },
  ];

  // IMPORTANT: Check full text for known couriers FIRST (most reliable)
  const fullTextUpper = text.toUpperCase();
  for (const { pattern, name } of courierPatterns) {
    if (pattern.test(fullTextUpper)) {
      return name;
    }
  }
  
  // TRACKING NUMBER PATTERNS - use as fallback when logo is an image
  
  // Ekart tracking: starts with IOIC
  const hasEkartTracking = /IOIC\d{10,}/.test(text);
  if (hasEkartTracking) {
    return 'Ekart';
  }
  
  // Delhivery AWB patterns: 
  // - 14 digit numbers starting with 27, 28, 29 (common Delhivery prefixes)
  // - Also check for absence of Ekart tracking
  const delhiveryAwbPattern = /\b(27|28|29)\d{12}\b/;
  const generic14DigitAwb = /\b\d{14}\b/;
  
  if (delhiveryAwbPattern.test(text)) {
    return 'Delhivery';
  }
  
  // If there's a 14-digit AWB and NO Ekart tracking, likely Delhivery
  if (generic14DigitAwb.test(text) && !hasEkartTracking) {
    // Additional check: Delhivery labels often have specific patterns
    // Look for common Delhivery-related text
    if (/Ref\.\/Invoice/i.test(text) || /Order\s*Number/i.test(text)) {
      return 'Delhivery';
    }
  }

  // Courier is in TOP RIGHT box - check first 5 lines as fallback
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    
    // Skip warehouse codes in parentheses
    if (line.match(/^\([A-Z]{3}\/[A-Z]{3}\)$/)) continue;
    
    // Skip barcodes
    if (line.match(/^\d{13,}$/)) continue;
    
    // Check line OR parts of line (if separated by gaps)
    const parts = line.split(/\s{3,}/);
    
    for (const part of parts) {
      if (part.length < 3) continue;
      
      // Check for known courier patterns
      for (const { pattern, name } of courierPatterns) {
        if (pattern.test(part)) {
          return name;
        }
      }
      
      // Fallback: Check for Uppercase Courier-like text
      // But exclude brand names and common words
      if (part.match(/^[A-Z]{3,20}$/)) {
        const partLower = part.toLowerCase();
        // Skip if it's a brand indicator or common word
        if (part.match(/\b(GOODS|STORE|SHOP|MART|BRAND|SHOPPERS|KART)\b/i)) {
          continue;
        }
        // Skip common non-courier words
        if (!part.match(/^(COD|PIN|SKU|QTY|DATE|ORDER|INVOICE|TOTAL|PRICE|RS|ADDRESS|DELIVER|TO|FROM|NUMBER|VALUE|KART|SHOPPERS)$/i)) {
          // Check if it's not a known brand name
          if (partLower !== 'zen' && partLower !== 'goods' && partLower !== 'shoppers' && partLower !== 'kart') {
            return part;
          }
        }
      }
    }
  }

  return '';
}

/**
 * Extract product name from PDF text
 * ONLY extract from Product Name column (left side), NOT the SKU column
 * 
 * Handles various formats:
 * 1. Single line: "Product Name SKU Qty Price" followed by "Suction Cup Handle BATHROOM-GST... 1 599"
 * 2. Split lines: "Product" / "Name" headers on separate lines
 * 3. 'Item Name' header (ShoppersKart/XpressBees)
 * 4. Multi-line product names: "Garden" / "Manual" / "Sprayer" on separate lines
 */
function extractProductName(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Find product table header - be flexible
  let headerIndex = -1;
  
  // Try 1: "Product Name" or "Item Name" with SKU/Qty/Price on same line
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i].match(/Product\s*Name/i) || lines[i].match(/Item\s*Name/i)) && lines[i].match(/SKU|Qty|Price|Amount/i)) {
      headerIndex = i;
      break;
    }
  }
  
  // Try 2: Just "Product" followed by "Name" on next line (split header)
  if (headerIndex === -1) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].match(/^Product$/i) && lines[i + 1].match(/^Name$/i)) {
        headerIndex = i + 1; // Start after "Name"
        break;
      }
    }
  }
  
  // Try 3: Look for just "Product Name" or "Item Name" or "Item description" anywhere
  if (headerIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/(Product|Item)\s*(Name|description)/i)) {
        headerIndex = i;
        break;
      }
    }
  }
  
  // Try 4: Look for "SKU" followed by product data pattern
  if (headerIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^SKU$/i) || lines[i].match(/SKU\s+Qty/i)) {
        headerIndex = i;
        break;
      }
    }
  }
  
  if (headerIndex !== -1) {
    // Collect product name words - stop at SKU patterns or Total
    let productNameWords = [];
    
    for (let i = headerIndex + 1; i < lines.length; i++) {
      let line = lines[i];
      
      // Stop at totals
      if (line.match(/^(Total|Subtotal|Grand\s*Total|Discount)/i)) break;
      if (line.match(/^pE[\s\-–—T]+|pE\s*\d+/i)) continue; // Skip garbage
      if (line.length < 2) continue;
      
      // Check if entire line is a SKU pattern - skip it
      if (/GST|HSN/i.test(line)) continue;
      if (/^[A-Z\s]+-[A-Z0-9-]+$/.test(line)) continue; // WATER DISPENSER-GST-18...
      if (/^[A-Z]{3,}\s*-\d+-/.test(line)) continue; // XXX-18-HSN
      
      // Strip qty/price from end if present
      line = line.replace(/\s+\d+\s+[Rs.₹]*\d+[\d.]*\s*$/, '').trim();
      if (!line) continue;
      
      // Process words in this line
      let words = line.split(/\s+/);
      
      // Remove multiple leading SKU tokens (consistent with filterOutSku)
      while (words.length > 1) {
        const firstWord = words[0];
        
        const isSkuLike = 
          firstWord.endsWith('...') || 
          (/^[A-Z0-9.-]+$/.test(firstWord) && firstWord.length > 2 && !/^[A-Z][a-z]+/.test(firstWord));

        if (isSkuLike) {
           const rest = words.slice(1).join(' ');
           if (/[A-Z][a-z]/.test(rest) || words.length > 2) {
              words.shift(); 
              continue;
           }
        }
        break;
      }
      
      let stopProcessing = false;
      
      for (const word of words) {
        if (!word || word.length < 1) continue;
        
        // Stop immediately if we hit GST/HSN
        if (/GST|HSN/i.test(word)) {
          stopProcessing = true;
          break;
        }
        
        // Stop if word is SKU-like pattern (UPPERCASE-NUMBERS-...)
        if (/^[A-Z]+-\d+/.test(word) || /^\d+-[A-Z]+/.test(word)) {
          stopProcessing = true;
          break;
        }
        
        // Skip pure numbers
        if (/^\d+$/.test(word)) continue;
        
        // For ALL UPPERCASE words of 4+ chars, check if it's likely SKU
        if (word.length >= 4 && /^[A-Z]+$/.test(word)) {
          // If followed by GST/HSN or duplicate, unlikely to be part of name
           if (productNameWords.length > 0) {
            const wordIndex = words.indexOf(word);
            if (wordIndex < words.length - 1) {
              const nextWord = words[wordIndex + 1];
              if (/^GST|HSN|-/i.test(nextWord)) {
                stopProcessing = true;
                break;
              }
            }
             // Also skip if duplicate of previous word
            const lastWord = productNameWords[productNameWords.length - 1];
            if (lastWord && lastWord.toLowerCase() === word.toLowerCase()) {
              stopProcessing = true;
              break;
            }
          }
        }
        
        productNameWords.push(word);
      }
      
      if (stopProcessing) break;
      
      // Check if next line is Total or Discount
      if (i + 1 < lines.length && lines[i+1].match(/^(Total|Subtotal|Discount)/i)) {
        break;
      }
    }
    
    // Join and clean
    let fullProductName = productNameWords.join(' ').trim();
    
    // Final cleanup
    fullProductName = fullProductName
      .replace(/\s+[A-Z]+-GST.*$/i, '')
      .replace(/\s+[A-Z0-9-]*HSN.*$/i, '')
      .trim();
    
    if (fullProductName.length > 2) {
      return fullProductName;
    }
  }
  
  return '';
}

/**
 * Parses the "# | Item description" table for Amazon labels.
 * User-provided robust logic.
 */
function extractAmazonProducts(text) {
  const products = [];
  
  // USER'S APPROACH: Look for "Item description" block
  const itemBlock = text.match(/Item\s*description([\s\S]*?)(\n\n|$)/i);
  
  if (itemBlock) {
    const lines = itemBlock[1].split('\n').map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
      // Skip header/noise lines
      if (line.match(/^#|qty|^\d+$/i)) continue;
      if (line.length < 4) continue;
      
      // Skip footer patterns and garbage
      if (/STVM|MSTA|MRJA|PTAF|amazon\s*shipping|^pE[—\-_]*T?$/i.test(line)) continue;
      
      // Extract product name (strip leading number and QTY suffix)
      let name = line.replace(/^\d+\s+/, '').trim();
      name = name.replace(/\s*QTY\s*[-–—:]\s*\d+.*$/i, '').trim();
      
      if (name && name.length > 3) {
        const qtyMatch = line.match(/QTY\s*[-–—:]\s*(\d+)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        products.push({ product_name: name, quantity: qty, price: 0 });
      }
    }
  }
  
  // FALLBACK: If no products found via item block, try generic line detection
  if (products.length === 0) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    for (const line of lines) {
      // Skip common non-product patterns
      if (line.match(/awb|invoice|date|ship|gst|cod|order|address|from|to|pin|sector|zone|^\d+$/i)) continue;
      if (/STVM|MSTA|MRJA|PTAF|amazon|shipping/i.test(line)) continue;
      if (line.length < 6 || line.length > 100) continue;
      
      // Check for QTY pattern - strong indicator of product line
      const qtyMatch = line.match(/(.+?)\s*QTY\s*[-–—:]\s*(\d+)/i);
      if (qtyMatch) {
        let name = qtyMatch[1].replace(/^\d+\s+/, '').trim();
        if (name && name.length > 3) {
          products.push({ product_name: name, quantity: parseInt(qtyMatch[2]), price: 0 });
        }
      }
    }
  }
  
  return products;
}

/**
 * "Garden Manual Sprayer QTY – 1"  →  "Garden Manual Sprayer"
 * Handles –  -  —  with or without spaces.
 */
function parseAmazonItemName(line) {
  const cut = line.replace(/\s*QTY\s*[-–—]\s*\d+\s*$/i, '').trim();
  return cut || line.trim();
}

/**
 * Extract MULTIPLE products from PDF text
 * Returns an array of product objects: [{product_name, quantity, price}, ...]
 * 
 * Each product row ends with qty + price pattern (e.g., "1 499.00")
 * Product names may span multiple lines until the qty/price pattern is found
 */
function extractProducts(text) {
  // Check if Amazon Label first (User requested priority)
  if (
    text.toUpperCase().includes('AMAZON SHIPPING') || 
    (text.toUpperCase().includes('ITEM DESCRIPTION') && text.toUpperCase().includes('ORDERED FROM'))
  ) {
      const amazonProducts = extractAmazonProducts(text);
      if (amazonProducts.length > 0) return amazonProducts;
  }

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const products = [];
  
  // Find product table header
  let headerIndex = -1;

  // Check for Amazon "Item description" header
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('item description')) {
      headerIndex = i;
      // Amazon labels usually list products starting from the next line
      // Format: "1 Garden Manual Sprayer QTY-1"
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        
        // Stop if we hit footer markers
        if (line.match(/STVM|MSTA|MRJA|PTAF|amazon/)) break;
        // Use inclusive match without anchors to catch footer text anywhere
        if (line.match(/STVM|MSTA|MRJA|PTAF|amazon\s*shipping/i)) break;
        // Don't break on separator lines, just skip them
        if (line.match(/^_{3,}/)) continue;

        // Pattern: Number + Name + QTY-Number
        // e.g. "1 Garden Manual Sprayer QTY-1"
        // Flexible regex for OCR errors and formats:
        // REMOVED $ anchor at end to handle cases where footer text merges onto same line
        // e.g. "1 Garden Manual Sprayer QTY-1 |MSTA..."
        const amazonMatch = line.match(/^(?:[\d|Il\s\-–\.#]+)?(.+?)\s*(?:QTY|OTY|QTV)[\s:\-–]*(\d+)/i);
                            
        if (amazonMatch) {
           let pName = amazonMatch[1].trim();
           // Clean up leading pipe/hash if captured
           pName = pName.replace(/^[|#]\s*/, '');
           
           products.push({
             product_name: pName,
             quantity: parseInt(amazonMatch[2]),
             price: 0 
           });
           continue;
        }

        // Fallback checks
        const fallbackMatch = line.match(/^(?:[\d|Il\s\|\-–\.#]+)?(.+)$/);
        if (fallbackMatch) {
             let candidateName = fallbackMatch[1].trim();
             
             // Check if we missed the QTY split
             const qtySplit = candidateName.match(/(.+?)\s*(?:QTY|OTY|QTV)/i);
             if (qtySplit) {
                 candidateName = qtySplit[1].trim();
             }

             // Cleanup leading pipe/hash
             candidateName = candidateName.replace(/^[|#]\s*/, '');

             // Strict validation against footer keywords
             if (candidateName.match(/STVM|MSTA|MRJA|PTAF|amazon/i)) break;
             
             if (candidateName.match(/^Item\s*description/i)) continue;
             if (candidateName.match(/^(Total|Subtotal|Page)/i)) break;
             if (candidateName.match(/^[\d|Il]+$/)) continue;
             if (candidateName.match(/^pE[\s\-–—T]+|pE\s*\d+/i)) continue;

             if (candidateName.length > 3 && !candidateName.includes('__')) {
                 products.push({
                     product_name: candidateName,
                     quantity: 1,
                     price: 0
                 });
                 continue;
             }
        }
      }
      if (products.length > 0) return products;
    }
  }

  // Check for "Product Price Qty" header (EKART / Shopperskart table)
  // Header often: Product | Price | Qty
  // Data: Product Name (multiline) | Price | Qty
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/Product/i) && lines[i].match(/Price/i) && lines[i].match(/Qty/i)) {
      let accumulatedName = [];
      
      for (let j = i + 1; j < lines.length; j++) {
         const line = lines[j];
         // Stop at footer or Total
         if (line.match(/Total|Subtotal/i)) break;
         if (line.match(/^EKART/i)) break;
         if (line.match(/^Instructions/i)) break;
         if (line.length < 2) continue;

         // Check for Price + Qty at end of line
         // Regex: (Price) (Qty)
         // e.g. "1999.00 1" or "19,999.00 1"
         const priceQtyMatch = line.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+(\d+)$/);
         
         if (priceQtyMatch) {
             const price = parseFloat(priceQtyMatch[1].replace(/,/g, ''));
             const qty = parseInt(priceQtyMatch[2]);
             
             // Get the name part from this line (if any)
             const namePart = line.replace(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+(\d+)$/, '').trim();
             
             if (namePart) {
                 accumulatedName.push(namePart);
             }
             
             if (accumulatedName.length > 0) {
                 products.push({
                     product_name: accumulatedName.join(' ').trim(),
                     quantity: qty,
                     price: price
                 });
                 accumulatedName = []; // Reset for next product if any
             }
         } else {
             // Treat as part of name if not garbage and not a footer line we missed
             if (!line.match(/^\d+$/)) { // Skip purely numeric lines (e.g. barcodes/ids misread)
                accumulatedName.push(line);
             }
         }
      }
      if (products.length > 0) return products;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i].match(/Product\s*Name/i) || lines[i].match(/Item\s*Name/i)) && lines[i].match(/SKU|Qty|Price|Amount/i)) {
      headerIndex = i;
      break;
    }
  }
  
  if (headerIndex === -1) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].match(/^Product$/i) && lines[i + 1].match(/^Name$/i)) {
        headerIndex = i + 1;
        break;
      }
    }
  }
  
  if (headerIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^Product\s*Name$/i) || lines[i].match(/^Item\s*Name$/i)) {
        headerIndex = i;
        break;
      }
    }
  }
  
  if (headerIndex === -1) {
    return products;
  }
  
  // Accumulate words for current product
  let currentProductWords = [];
  
  for (let i = headerIndex + 1; i < lines.length; i++) {
    let line = lines[i];
    
    // Stop at totals or discounts
    if (line.match(/^(Total|Subtotal|Grand\s*Total|Discount)/i)) {
      // If we have accumulated words, save as product without qty/price
      if (currentProductWords.length > 0) {
        products.push({
          product_name: currentProductWords.join(' ').trim(),
          quantity: 1,
          price: 0
        });
        currentProductWords = []; // Clear after pushing
      }
      // Don't break completely if just "Discount", might be more products? 
      // Usually Total is end, but Discount is intermediate row.
      if (line.match(/Total/i)) break; 
      continue;
    }
    
    if (line.length < 2) continue;
    
    // Skip entire SKU lines
    if (/^[A-Z\s]+-GST-\d+-HSN\d+$/.test(line)) continue;
    if (/^[A-Z]+\s+[A-Z]+-GST-/.test(line)) continue;
    
    // Check if line ends with qty + price pattern (e.g., "Trap Pad 1 499.00" or just "1 499.00")
    // Modified regex to handle currency symbols or just numbers
    const qtyPriceMatch = line.match(/(\d+)\s+([Rs.₹]*\d+(?:\.\d{1,2})?)\s*$/);
    
    if (qtyPriceMatch) {
      // This line ends a product row
      const qty = parseInt(qtyPriceMatch[1], 10) || 1;
      let priceStr = qtyPriceMatch[2].replace(/[Rs.₹]/g, '');
      const price = parseFloat(priceStr) || 0;
      
      // Get text before qty/price
      let textBeforeQtyPrice = line.replace(/\d+\s+[Rs.₹]*\d+(?:\.\d{1,2})?\s*$/, '').trim();
      
      // Filter out SKU patterns
      textBeforeQtyPrice = filterOutSku(textBeforeQtyPrice);
      
      // Add to accumulated words
      if (textBeforeQtyPrice && textBeforeQtyPrice.length > 0) {
        currentProductWords.push(textBeforeQtyPrice);
      }
      
      // Build final product name
      let productName = currentProductWords.join(' ').trim();
      
      // Final cleanup
      productName = productName
        .replace(/\s+[A-Z]+-GST.*$/i, '')
        .replace(/\s+[A-Z0-9-]*HSN.*$/i, '')
        .replace(/\s+RAT\s+TRAP-.*$/i, '')
        .trim();
      
      if (productName.length > 2) {
        products.push({
          product_name: productName,
          quantity: qty,
          price: price
        });
      }
      
      // Reset for next product
      currentProductWords = [];
    } else {
      // Line part of product name
      const filteredLine = filterOutSku(line);
      if (filteredLine && filteredLine.length > 0) {
        currentProductWords.push(filteredLine);
      }
    }
  }
  
  return products;
}

/**
 * Helper function to filter out SKU patterns from text
 */
function filterOutSku(text) {
  if (!text) return '';
  
  // If entire text is SKU pattern, return empty
  if (/^[A-Z\s]+-GST-\d+-HSN\d+$/i.test(text)) return '';
  if (/^[A-Z]+\s+[A-Z]+-GST-/i.test(text)) return '';
  if (/GST-\d+-HSN/i.test(text)) return '';
  
  // Split by words and filter
  let words = text.split(/\s+/);
  
  // Remove multiple leading SKU tokens (e.g. "HAIR CUTT..." for ShoppersKart)
  // Continue removing words from the start as long as they look like SKU components
  while (words.length > 1) {
    const firstWord = words[0];
    
    // Check if word is SKU-like:
    // 1. Ends with '...'
    // 2. Is ALLcaps with length > 2
    // 3. Is alphanumeric code
    const isSkuLike = 
      firstWord.endsWith('...') || 
      (/^[A-Z0-9.-]+$/.test(firstWord) && firstWord.length > 2 && !/^[A-Z][a-z]+/.test(firstWord));

    if (isSkuLike) {
       // Check if remaining words look like product Name (Title Case)
       const rest = words.slice(1).join(' ');
       if (/[A-Z][a-z]/.test(rest) || words.length > 2) {
          words.shift(); 
          continue; // Check the next word (e.g. "CUTT..." after "HAIR" was removed)
       }
    }
    
    // Also remove "HAIR" specifically if followed by something that looks like part of SKU (heuristic for this specific label)
    // Or if we have a very clear SKU pattern split across words
    
    break; // Stop if not SKU-like
  }

  const filteredWords = [];
  
  for (const word of words) {
    if (!word) continue;
    
    // Stop at GST/HSN patterns
    if (/GST|HSN/i.test(word)) break;
    if (/^[A-Z]+-\d+-/.test(word)) break;
    
    // Skip if word is duplicate of previous (case insensitive) - likely SKU version
    if (filteredWords.length > 0) {
      const lastWord = filteredWords[filteredWords.length - 1];
      if (lastWord.toLowerCase() === word.toLowerCase() && /^[A-Z]+$/.test(word)) {
        break;
      }
    }
    
    filteredWords.push(word);
  }
  
  return filteredWords.join(' ').trim();
}


/**
 * Extract Order Number or AWB from PDF text
 * Used for duplicate detection
 * 
 * PRIORITY: AWB/Barcode (more universal) > Order ID
 */
function extractOrderNumber(text, courierName) {
  const lines = text.split('\n').map(l => l.trim());
  
  // 1. EKART / ShoppersKart: Look for "IOIC" pattern (commonly under barcode)
  const ekartMatch = text.match(/\b(IOIC\d{9,})\b/);
  if (ekartMatch) return ekartMatch[1];

  // 2. Courier specific patterns (AWB preferred)
  
  // Amazon: "AWB 123456789"
  // Note: Amazon Order IDs (3-7-7 format) are also very distinct and reliable unique keys. 
  // We check AWB first as requested, but if missing, Order ID is essentially the "AWB" for Amazon ecosystem.
  if (courierName === 'Amazon Shipping' || text.match(/Amazon\s*Shipping/i)) {
      const awbMatch = text.match(/AWB\s*([0-9]{10,})/i);
      if (awbMatch) return awbMatch[1];
  }

  // Delhivery: Look for AWB (13-14 digits starting with 2, 3, etc)
  if (courierName === 'Delhivery') {
      const awbMatch = text.match(/(?:AWB|Tracking\s*ID)[\s:]*([0-9]{12,})/i);
      if (awbMatch) return awbMatch[1];
      
      const matches = text.match(/\b(2[0-9]{11,})\b/g); // Common Delhivery AWB start
      if (matches && matches.length > 0) return matches[0];
  }

  // 3. General AWB / Tracking ID labels
  const trackingMatch = text.match(/(?:AWB|Tracking\s*ID|Waybill)[\s#:]*([A-Z0-9]{8,})/i);
  if (trackingMatch) return trackingMatch[1];

  // 4. Standalone Barcode-like Numbers (12+ digits)
  // This is the "Universal" fallback for "number under barcode"
  const potentialBarcodes = text.match(/\b\d{12,20}\b/g);
  if (potentialBarcodes) {
    for (const code of potentialBarcodes) {
      if (!code.startsWith('91') && !code.startsWith('0')) { // Filter out likely phone numbers
         return code;
      }
    }
  }

  // 5. Fallback: "Order ID" / "Order No"
  // Only use if no AWB/Barcode found
  for (const line of lines) {
    const orderIdMatch = line.match(/(?:Order\s*ID|Order\s*No\.?|Order\s*#)[\s:]*([A-Z0-9\-_]{5,})/i);
    if (orderIdMatch) {
       if (!orderIdMatch[1].match(/^(SKU|QTY|DATE|INVOICE)$/i)) {
         return orderIdMatch[1];
       }
    }
    
    if (line.match(/Ref\/?Invoice/i)) {
       const refMatch = line.match(/Ref\/?Invoice[\s:]*([A-Z0-9\-_]+)/i);
       if (refMatch) return refMatch[1];
    }
  }

  return '';
}

module.exports = {
  extractLabelMetadata,
  extractBrandName,
  extractCourierCompany,
  extractProductName,
  extractProducts,
  extractOrderNumber,
  extractCustomerName
};

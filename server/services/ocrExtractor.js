
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const { execSync } = require('child_process');

// --- Shared Tesseract Worker Pool ---
// Avoids creating/destroying workers per OCR call (~2-5s overhead each)
let _sharedWorker = null;
let _workerRefCount = 0;
let _workerIdleTimer = null;

async function getSharedWorker() {
    if (!_sharedWorker) {
        _sharedWorker = await Tesseract.createWorker('eng');
    }
    _workerRefCount++;
    // Clear any pending idle cleanup
    if (_workerIdleTimer) {
        clearTimeout(_workerIdleTimer);
        _workerIdleTimer = null;
    }
    return _sharedWorker;
}

function releaseSharedWorker() {
    _workerRefCount--;
    if (_workerRefCount <= 0) {
        _workerRefCount = 0;
        // Auto-terminate after 30s of inactivity to free memory
        _workerIdleTimer = setTimeout(async () => {
            if (_sharedWorker && _workerRefCount === 0) {
                try {
                    await _sharedWorker.terminate();
                } catch (e) { /* ignore */ }
                _sharedWorker = null;
            }
        }, 30000);
    }
}

/**
 * Extracts Amazon product text from a high-res PDF render using pixel projection.
 * @param {string} pdfPath
 * @returns {Promise<string>}
 */
async function extractAmazonProduct(pdfPath) {
    const tempDir = '/tmp/amazon-ocr-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });

    let workerAcquired = false;

    try {
        // 1. Render PDF to High-Res PNG (6000px height is good for detail)
        console.log('[OCR] Rendering PDF...');
        const outputPrefix = path.join(tempDir, 'page');
        // usage of pdftocairo (poppler)
        execSync(`pdftocairo -png -f 1 -l 1 -scale-to 6000 "${pdfPath}" "${outputPrefix}"`, { stdio: 'pipe' });

        const files = fs.readdirSync(tempDir);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (!pngFile) throw new Error('PDF conversion failed');

        const imagePath = path.join(tempDir, pngFile);

        // 2. Crop Layout Area (35% to 55%)
        const metadata = await sharp(imagePath).metadata();
        const cropTop = Math.floor(metadata.height * 0.35);
        const cropHeight = Math.floor(metadata.height * 0.20);

        const { data: rawData, info } = await sharp(imagePath)
            .extract({ left: 0, top: cropTop, width: metadata.width, height: cropHeight })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 3. Pixel Projection (Horizontal)
        // Count dark pixels per row
        const rowDensity = new Array(info.height).fill(0);
        for (let y = 0; y < info.height; y++) {
            let sum = 0;
            const rowOffset = y * info.width;
            for (let x = 0; x < info.width; x += 10) { // sample every 10th
                if (rawData[rowOffset + x] < 200) sum++;
            }
            rowDensity[y] = sum;
        }

        // 4. Find Blobs (Text Lines)
        const blobs = [];
        let inBlob = false;
        let startY = 0;
        const LINE_THRESHOLD = 5; // density threshold
        const MIN_BLOB_HEIGHT = 10;

        for (let y = 0; y < info.height; y++) {
            const hasContent = rowDensity[y] > LINE_THRESHOLD;
            if (hasContent && !inBlob) {
                inBlob = true;
                startY = y;
            } else if (!hasContent && inBlob) {
                inBlob = false;
                if (y - startY > MIN_BLOB_HEIGHT) {
                    blobs.push({ y: startY, h: y - startY });
                }
            }
        }

        // 5. OCR Process - use shared worker
        const worker = await getSharedWorker();
        workerAcquired = true;

        let headerIndex = -1;

        // Pass 1: Identify Structure
        for (let i = 0; i < Math.min(blobs.length, 5); i++) {
            const blob = blobs[i];
            const blobTop = Math.max(0, cropTop + blob.y - 10);
            const blobH = blob.h + 20;

            const blobBuffer = await sharp(imagePath)
                .extract({ left: 0, top: blobTop, width: metadata.width, height: blobH })
                .toBuffer();

            const { data } = await worker.recognize(blobBuffer);
            const text = data.text.trim();
            console.log(`[OCR] Line ${i}: "${text}"`);

            if (text.match(/Item\s*description/i)) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex !== -1 && headerIndex + 1 < blobs.length) {
            // Product is the next blob
            const productBlob = blobs[headerIndex + 1];
            console.log('[OCR] Target Blob identified.');

            const prodTop = cropTop + productBlob.y - 10;
            const prodH = productBlob.h + 20;

            const prodBuffer = await sharp(imagePath)
                .extract({ left: 0, top: prodTop, width: metadata.width, height: prodH })
                .toBuffer();

            const { data } = await worker.recognize(prodBuffer);
            let productText = data.text.trim();

            // CLEANUP
            // "Garden Manual Sprayer QTY -1" -> "Garden Manual Sprayer"
            productText = productText.replace(/QTY.*$/i, '')        // Remove QTY...
                                     .replace(/[\|\d\[\]]+$/g, '')  // Remove trailing pipes/digits
                                     .replace(/^[\|\d\s\[\]]+/g, '') // Remove leading garbage ([4 | )
                                     .replace(/[^\w\s\(\)-]/g, '')   // Remove weird special chars
                                     .trim();

            return productText;
        }

        return null;

    } catch (err) {
        console.error('[OCR Error]', err);
        return null;
    } finally {
        if (workerAcquired) releaseSharedWorker();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// Execute if run directly
if (require.main === module) {
    const PDF_PATH = '/Users/shubhankarhaldar/Desktop/Wms/manifest - 2026-01-29T145424.413-20-21 (1)-2.pdf';
    extractAmazonProduct(PDF_PATH).then(name => {
        console.log('\n==========================================');
        console.log('EXTRACTED PRODUCT NAME:', name);
        console.log('==========================================\n');
    });
}


/**
 * Wrapper to match the signature expected by pdfExtractor.js
 * Returns an object with products array and courier info
 */
async function extractLabelDataFromPdf(pdfPath) { 
    try {
        const product = await extractAmazonProduct(pdfPath);
        if (product) {
            return {
                products: [{
                    product_name: product,
                    quantity: 1, // OCR usually processes one item at a time for this specific fallback
                    price: 0
                }],
                courier_name: 'Amazon Shipping' // If this worked, it's likely Amazon
            };
        }
        return { products: [] };
    } catch (e) {
        console.error('[OCR Wrapper] Error:', e);
        return { products: [] };
    }
}

async function extractCourierFromImage(pdfPath) {
    const tempDir = '/tmp/ocr-courier-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });
    let workerAcquired = false;

    try {
        console.log('[OCR] Extracting courier from image...');
        const outputPrefix = path.join(tempDir, 'page');
        // Low scale (2000) is enough for courier logo headers usually
        execSync(`pdftocairo -png -f 1 -l 1 -scale-to 2000 "${pdfPath}" "${outputPrefix}"`, { stdio: 'pipe' });

        const files = fs.readdirSync(tempDir);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (!pngFile) return null;

        const imagePath = path.join(tempDir, pngFile);
        const metadata = await sharp(imagePath).metadata();

        // Crop Top 30% of the page
        const cropHeight = Math.floor(metadata.height * 0.30);

        const buffer = await sharp(imagePath)
             .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
             .toBuffer();

        const worker = await getSharedWorker();
        workerAcquired = true;
        const { data } = await worker.recognize(buffer);
        const text = data.text;

        console.log('[OCR] Courier Search Text:', text.substring(0, 100).replace(/\n/g, ' '));

        // Courier Regex Patterns
        const patterns = [
             { regex: /XPRESS\s*BEES/i, name: 'Xpressbees' },
             { regex: /XYXPRESSEBEES/i, name: 'Xpressbees' }, // Specific artifact
             { regex: /PRESSEBEES/i, name: 'Xpressbees' },
             { regex: />>XPRESS/i, name: 'Xpressbees' },
             { regex: /DELHIVERY/i, name: 'Delhivery' },
             { regex: /DELHIV/i, name: 'Delhivery' },
             { regex: /BLUE\s*DART/i, name: 'Blue Dart' },
             { regex: /DTDC/i, name: 'DTDC' },
             { regex: /ECOM\s*EXPRESS/i, name: 'Ecom Express' },
             { regex: /SHIP\s*ROCKET/i, name: 'Shiprocket' },
             { regex: /EKART/i, name: 'Ekart' },
             { regex: /AMAZON\s*SHIPPING/i, name: 'Amazon Shipping' }
        ];

        for (const p of patterns) {
            if (p.regex.test(text)) {
                console.log(`[OCR] Courier identified: ${p.name}`);
                return p.name;
            }
        }

        return null;

    } catch (e) {
        console.error('[OCR] Extract courier failed:', e);
        return null;
    } finally {
        if (workerAcquired) releaseSharedWorker();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function extractStoreFromImage(pdfPath) {
    // OCR the top 15% of the label where brand logos typically appear
    const tempDir = '/tmp/ocr-store-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });
    let workerAcquired = false;

    // Common address/locality words that should NEVER be a brand name
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

    try {
        const outputPrefix = path.join(tempDir, 'page');
        execSync(`pdftocairo -png -f 1 -l 1 -scale-to 2000 "${pdfPath}" "${outputPrefix}"`, { stdio: 'pipe' });

        const files = fs.readdirSync(tempDir);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (!pngFile) return null;

        const imagePath = path.join(tempDir, pngFile);
        const metadata = await sharp(imagePath).metadata();

        // Crop top 15% of the image only (logo area - tighter crop to avoid address text)
        const cropHeight = Math.floor(metadata.height * 0.15);
        const buffer = await sharp(imagePath)
            .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
            .toBuffer();

        const worker = await getSharedWorker();
        workerAcquired = true;
        const { data } = await worker.recognize(buffer);
        const ocrText = data.text || '';

        if (!ocrText.trim()) return null;

        console.log('Store OCR raw text:', ocrText.substring(0, 200));

        // Clean OCR lines and look for brand name
        const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length >= 2);

        // Skip known non-brand text
        const skipPatterns = [
            /^\d{5,}/, /shipping\s*address/i, /^pin/i, /^cod$/i, /^to:/i,
            /^\d{2}\/\d{2}\/\d{4}/, /barcode/i, /^I\d+C\d+/, /^\d+\s/
        ];

        for (const line of lines) {
            if (skipPatterns.some(p => p.test(line))) continue;
            const cleaned = line.replace(/[^a-zA-Z\s&'-]/g, '').trim();
            if (cleaned.length < 3 || cleaned.length > 30) continue;

            // Check if ALL words are address/generic words - if so, skip
            const words = cleaned.toLowerCase().split(/\s+/);
            const isAddress = words.every(w => addressWords.has(w) || w.length <= 1);
            if (isAddress) continue;

            // At least one word should NOT be an address word (likely the brand)
            const brandWords = words.filter(w => !addressWords.has(w) && w.length > 1);
            if (brandWords.length === 0) continue;

            return cleaned;
        }

        return null;
    } catch (e) {
        console.error('Store OCR failed:', e.message);
        return null;
    } finally {
        if (workerAcquired) releaseSharedWorker();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function extractTextFromRegion(pdfPath, region) {
    // Basic implementation of region extraction
    // region: { leftPercent, topPercent, widthPercent, heightPercent }
    const tempDir = '/tmp/ocr-region-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });
    let workerAcquired = false;

    try {
        const outputPrefix = path.join(tempDir, 'page');
        execSync(`pdftocairo -png -f 1 -l 1 -scale-to 2000 "${pdfPath}" "${outputPrefix}"`, { stdio: 'pipe' });

        const files = fs.readdirSync(tempDir);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (!pngFile) return '';

        const imagePath = path.join(tempDir, pngFile);
        const metadata = await sharp(imagePath).metadata();

        const left = Math.floor(metadata.width * region.leftPercent);
        const top = Math.floor(metadata.height * region.topPercent);
        const width = Math.floor(metadata.width * region.widthPercent);
        const height = Math.floor(metadata.height * region.heightPercent);

        const buffer = await sharp(imagePath)
             .extract({ left, top, width, height })
             .toBuffer();

        const worker = await getSharedWorker();
        workerAcquired = true;
        const { data } = await worker.recognize(buffer);
        return data.text;

    } catch (e) {
        console.error('Region OCR failed', e);
        return '';
    } finally {
        if (workerAcquired) releaseSharedWorker();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

module.exports = { 
    extractAmazonProduct,
    extractLabelDataFromPdf,
    extractCourierFromImage,
    extractStoreFromImage,
    extractTextFromRegion
};

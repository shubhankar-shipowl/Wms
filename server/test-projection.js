
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const { execSync } = require('child_process');

const PDF_PATH = '/Users/shubhankarhaldar/Desktop/Wms/manifest - 2026-01-29T145424.413-20-21 (1)-2.pdf';

async function run() {
    console.log('=== Pixel Projection Analysis ===');
    const tempDir = '/tmp/amazon-proj-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });

    // 1. Convert PDF
    const outputPrefix = path.join(tempDir, 'page');
    execSync(`pdftocairo -png -f 1 -l 1 -scale-to 6000 "${PDF_PATH}" "${outputPrefix}"`, { stdio: 'pipe' });
    const imagePath = path.join(tempDir, 'page-1.png');
    
    // 2. Crop Middle Area
    const metadata = await sharp(imagePath).metadata();
    const cropTop = Math.floor(metadata.height * 0.35);
    const cropHeight = Math.floor(metadata.height * 0.20); // 20% of 6000 = 1200px
    
    // Convert to raw grayscale
    const { data: rawData, info } = await sharp(imagePath)
        .extract({ left: 0, top: cropTop, width: metadata.width, height: cropHeight })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
        
    console.log(`Cropped: ${info.width}x${info.height} (channels: ${info.channels})`);
    
    // 3. Compute row density
    const rowDensity = new Array(info.height).fill(0);
    
    for (let y = 0; y < info.height; y++) {
        let sum = 0;
        const rowOffset = y * info.width;
        // Optimization: sample every 10th pixel to speed up
        for (let x = 0; x < info.width; x += 10) {
            const val = rawData[rowOffset + x];
            if (val < 200) { // Dark pixel
                sum++;
            }
        }
        rowDensity[y] = sum;
    }
    
    // 4. Find blobs (lines)
    const blobs = [];
    let inBlob = false;
    let startY = 0;
    
    for (let y = 0; y < info.height; y++) {
        const hasContent = rowDensity[y] > 5; // Threshold for line presence
        
        if (hasContent && !inBlob) {
            inBlob = true;
            startY = y;
        } else if (!hasContent && inBlob) {
            inBlob = false;
            // End of blob
            const h = y - startY;
            if (h > 10) { // Ignore noise
                blobs.push({ y: startY, h: h });
            }
        }
    }
    
    console.log(`Found ${blobs.length} blobs.`);
    
    // 5. Process blobs
    const worker = await Tesseract.createWorker('eng');
    
    for (let i = 0; i < Math.min(blobs.length, 10); i++) {
        const blob = blobs[i];
        console.log(`Blob ${i}: y=${blob.y}, h=${blob.h}`);
        
        // Extract blob from original image (to keep quality)
        // Add padding
        const pad = 10;
        const blobTop = Math.max(0, cropTop + blob.y - pad);
        const blobHeight = blob.h + (pad * 2);
        
        const blobBuffer = await sharp(imagePath)
            .extract({ left: 0, top: blobTop, width: metadata.width, height: blobHeight })
            .toBuffer();
             
        fs.writeFileSync(path.join(tempDir, `blob_${i}.png`), blobBuffer);
        
        // OCR check to identify "Item description"
        const { data: { text } } = await worker.recognize(blobBuffer);
        const cleanText = text.trim();
        console.log(`   Text: "${cleanText}"`);
        
        if (cleanText.match(/Item\s*description/i)) {
            console.log('   -> HEADER FOUND');
            // The blob AFTER this is likely the product
            if (i + 1 < blobs.length) {
                const productBlob = blobs[i+1];
                console.log('   -> TARGETING NEXT BLOB (Product)');
                
                // Process Product Blob with high res
                const prodTop = cropTop + productBlob.y;
                const prodBuffer = await sharp(imagePath)
                    .extract({ left: 0, top: prodTop, width: metadata.width, height: productBlob.h })
                    .resize({ height: 250, kernel: 'lanczos3' }) // Force height to 250px (huge upscale if line is small)
                    .negate() // Try Invert first
                    .sharpen()
                    .threshold(160)
                    .toBuffer();
                    
                fs.writeFileSync(path.join(tempDir, 'target_product.png'), prodBuffer);
                
                await worker.setParameters({ tessedit_pageseg_mode: '7' });
                const res = await worker.recognize(prodBuffer);
                console.log('   !!! PRODUCT OCR RESULT !!!');
                console.log(res.data.text);
                
                // Try non-inverted too
                const prodBuffer2 = await sharp(imagePath)
                    .extract({ left: 0, top: prodTop, width: metadata.width, height: productBlob.h })
                    .resize({ height: 250, kernel: 'lanczos3' })
                    .sharpen()
                    .threshold(160)
                    .toBuffer();
                const res2 = await worker.recognize(prodBuffer2);
                console.log('   !!! PRODUCT OCR RESULT (Normal) !!!');
                console.log(res2.data.text);
            }
        }
    }
    
    await worker.terminate();
    console.log('Done.');
}

run();

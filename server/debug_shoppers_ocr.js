
const Tesseract = require('tesseract.js');
const path = require('path');

// Image path from the user's upload
const imagePath = '/Users/shubhankarhaldar/.gemini/antigravity/brain/3e9b0b66-93c0-45c7-9a67-ead6147dc1bb/uploaded_media_1769980979504.png';

async function runDebug() {
  console.log('--- Running OCR Debug on Shoppers Kart Label ---');
  
  try {
    // Run OCR with PSM 6 (Single Uniform Block) as used in our service
    // Also try PSM 3 (Auto) to compare
    
    console.log('\n--- PSM 6 Output ---');
    const { data: { text: textPSM6 } } = await Tesseract.recognize(
      imagePath,
      'eng',
      { 
        logger: m => {},
        tessedit_pageseg_mode: '6'
      }
    );
    console.log(textPSM6);

    console.log('\n--- PSM 3 Output ---');
    const { data: { text: textPSM3 } } = await Tesseract.recognize(
      imagePath,
      'eng',
      { 
        logger: m => {},
        tessedit_pageseg_mode: '3'
      }
    );
    console.log(textPSM3);

  } catch (err) {
    console.error('Error:', err);
  }
}

runDebug();

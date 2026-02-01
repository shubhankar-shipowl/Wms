const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { extractLabelMetadata, extractProducts } = require('./pdfExtractor');

/**
 * Split a multi-page PDF into individual page PDFs and extract metadata
 */
async function splitPdfIntoPages(filePath, outputDir) {
  const results = [];
  
  try {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    console.log(`Splitting PDF with ${pageCount} pages...`);

    for (let pageNum = 0; pageNum < pageCount; pageNum++) {
      try {
        const newPdfDoc = await PDFDocument.create();
        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum]);
        newPdfDoc.addPage(copiedPage);

        const pagePdfBytes = await newPdfDoc.save();
        const pageFileName = `page-${pageNum + 1}-${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`;
        const pageFilePath = path.join(outputDir, pageFileName);
        
        fs.writeFileSync(pageFilePath, pagePdfBytes);

        // Extract metadata using new function
        const metadata = await extractLabelMetadata(pageFilePath);
        
        // Also extract products array for multi-product labels
        // Read the PDF text to pass to extractProducts
        const pdfParseModule = require('pdf-parse');
        let products = [];
        try {
          const dataBuffer = fs.readFileSync(pageFilePath);
          const parser = new pdfParseModule.PDFParse({ data: dataBuffer });
          const textData = await parser.getText();
          const text = textData.text || '';
          await parser.destroy();
          products = extractProducts(text);
        } catch (e) {
          console.error('Error extracting products:', e);
        }
        
        // Add products to metadata
        metadata.products = products;

        results.push({
          pageNumber: pageNum + 1,
          filePath: pageFilePath,
          filename: pageFileName,
          metadata: metadata,
        });

      } catch (pageError) {
        console.error(`Error processing page ${pageNum + 1}:`, pageError);
      }
    }

    return results;
  } catch (error) {
    console.error('Error splitting PDF:', error);
    throw error;
  }
}

async function getPdfPageCount(filePath) {
  try {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    return pdfDoc.getPageCount();
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    return 1;
  }
}

module.exports = {
  splitPdfIntoPages,
  getPdfPageCount,
};

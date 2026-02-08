const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { extractLabelMetadata } = require('./pdfExtractor');

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

    // Step 1: Split all pages into individual files first (fast, CPU-bound)
    const pageFiles = [];
    for (let pageNum = 0; pageNum < pageCount; pageNum++) {
      try {
        const newPdfDoc = await PDFDocument.create();
        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum]);
        newPdfDoc.addPage(copiedPage);

        const pagePdfBytes = await newPdfDoc.save();
        const pageFileName = `page-${pageNum + 1}-${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`;
        const pageFilePath = path.join(outputDir, pageFileName);

        fs.writeFileSync(pageFilePath, pagePdfBytes);
        pageFiles.push({ pageNum: pageNum + 1, filePath: pageFilePath, filename: pageFileName });
      } catch (pageError) {
        console.error(`Error splitting page ${pageNum + 1}:`, pageError);
      }
    }

    // Step 2: Extract metadata concurrently (with concurrency limit to avoid memory issues)
    const CONCURRENCY = 3;
    for (let i = 0; i < pageFiles.length; i += CONCURRENCY) {
      const batch = pageFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (pageFile) => {
          try {
            // extractLabelMetadata already returns products array - no need to parse again
            const metadata = await extractLabelMetadata(pageFile.filePath);
            return {
              pageNumber: pageFile.pageNum,
              filePath: pageFile.filePath,
              filename: pageFile.filename,
              metadata: metadata,
            };
          } catch (pageError) {
            console.error(`Error processing page ${pageFile.pageNum}:`, pageError);
            return null;
          }
        })
      );
      results.push(...batchResults.filter(Boolean));
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

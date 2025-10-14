const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { pool } = require('../config/database');

// Configure multer for memory storage (we'll store in database)
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const errorMessage = `Invalid file format. Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP). Received: ${
      fileExtension || 'unknown format'
    }`;
    cb(new Error(errorMessage));
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit per file (reduced for faster processing)
    files: 4, // Maximum 4 files per product
  },
  fileFilter: fileFilter,
});

// Middleware to process and store images in database
const processImages = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    console.log('No images to process, skipping...');
    return next();
  }

  try {
    console.log(`Processing ${req.files.length} images...`);
    console.log(
      'File details:',
      req.files.map((f) => ({
        name: f.originalname,
        size: f.size,
        type: f.mimetype,
      })),
    );
    const startTime = Date.now();

    // Process all images in parallel for better performance
    const processedImages = await Promise.all(
      req.files.map(async (file) => {
        try {
          // Process original image
          const originalBuffer = file.buffer;

          // Get metadata first (lightweight operation)
          const metadata = await sharp(originalBuffer).metadata();

          // Process optimized image and thumbnail in parallel
          const [optimizedBuffer, thumbnailBuffer] = await Promise.all([
            // Create optimized image (400x300 max - much smaller for faster processing)
            sharp(originalBuffer)
              .resize(400, 300, {
                fit: 'inside',
                withoutEnlargement: true,
              })
              .jpeg({
                quality: 60,
                progressive: false,
                mozjpeg: false,
              })
              .toBuffer(),

            // Create thumbnail (100x75 - much smaller for faster processing)
            sharp(originalBuffer)
              .resize(100, 75, {
                fit: 'cover',
              })
              .jpeg({
                quality: 50,
                progressive: false,
                mozjpeg: false,
              })
              .toBuffer(),
          ]);

          return {
            filename: file.originalname,
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            imageData: optimizedBuffer,
            thumbnailData: thumbnailBuffer,
            width: metadata.width,
            height: metadata.height,
          };
        } catch (error) {
          console.error(`Error processing image ${file.originalname}:`, error);
          console.error('Image details:', {
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            bufferLength: file.buffer.length,
          });

          // Check for specific error types and provide better error messages
          let errorMessage = 'Failed to process image';

          if (
            error.message.includes(
              'Input file contains unsupported image format',
            )
          ) {
            errorMessage = `Unsupported image format: ${file.originalname}. Please use JPEG, PNG, GIF, or WEBP format.`;
          } else if (error.message.includes('Input file is missing')) {
            errorMessage = `Image file is corrupted or empty: ${file.originalname}`;
          } else if (
            error.message.includes('Input file is not of a supported format')
          ) {
            errorMessage = `Invalid image format: ${file.originalname}. Please ensure the file is a valid image.`;
          } else if (file.size > 2 * 1024 * 1024) {
            errorMessage = `Image file too large: ${file.originalname}. Maximum size allowed is 2MB.`;
          } else {
            errorMessage = `Failed to process image ${file.originalname}. Please check if the file is a valid image.`;
          }

          // Throw a more descriptive error instead of creating fallback
          throw new Error(errorMessage);
        }
      }),
    );

    const processingTime = Date.now() - startTime;
    console.log(`Image processing completed in ${processingTime}ms`);

    req.processedImages = processedImages;
    next();
  } catch (error) {
    console.error('Image processing error:', error);
    next(error);
  }
};

// Function to save images to database
const saveImagesToDatabase = async (productId, images) => {
  if (!images || images.length === 0) {
    return [];
  }

  console.log(`Saving ${images.length} images to database...`);
  const startTime = Date.now();

  try {
    // Use individual inserts to prevent lock timeouts
    const imageIds = [];
    const now = new Date();

    console.log(`Starting database insert for ${images.length} images...`);

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(
        `Inserting image ${i + 1}/${images.length}: ${image.filename} (${
          image.imageData.length
        } bytes)`,
      );

      const imageStartTime = Date.now();

      // Retry logic for database operations
      let retries = 3;
      let result;

      while (retries > 0) {
        try {
          [result] = await pool.execute(
            `INSERT INTO product_images 
             (product_id, filename, original_name, mime_type, file_size, image_data, thumbnail_data, width, height, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              productId,
              image.filename,
              image.originalName,
              image.mimeType,
              image.fileSize,
              image.imageData,
              image.thumbnailData,
              image.width,
              image.height,
              now,
              now,
            ],
          );
          break; // Success, exit retry loop
        } catch (error) {
          retries--;
          if (retries === 0) {
            throw error; // Re-throw if all retries exhausted
          }
          console.log(
            `Database insert failed, retrying... (${retries} retries left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }

      const imageTime = Date.now() - imageStartTime;
      console.log(
        `Image ${i + 1} inserted in ${imageTime}ms (ID: ${result.insertId})`,
      );

      imageIds.push(result.insertId);
    }

    const dbTime = Date.now() - startTime;
    console.log(`Database save completed in ${dbTime}ms`);

    return imageIds;
  } catch (error) {
    console.error('Error saving images to database:', error);
    throw error;
  }
};

// Function to get images from database
const getImagesFromDatabase = async (productId) => {
  const [images] = await pool.execute(
    'SELECT id, filename, original_name, mime_type, file_size, width, height, created_at FROM product_images WHERE product_id = ? ORDER BY created_at ASC',
    [productId],
  );

  return images;
};

// Function to delete images from database
const deleteImagesFromDatabase = async (imageIds) => {
  if (!imageIds || imageIds.length === 0) {
    return;
  }

  const placeholders = imageIds.map(() => '?').join(',');
  await pool.execute(
    `DELETE FROM product_images WHERE id IN (${placeholders})`,
    imageIds,
  );
};

// Function to get image data from database
const getImageData = async (imageId, type = 'full') => {
  const [images] = await pool.execute(
    `SELECT ${
      type === 'thumbnail' ? 'thumbnail_data' : 'image_data'
    } as data, mime_type FROM product_images WHERE id = ?`,
    [imageId],
  );

  if (images.length === 0) {
    return null;
  }

  return {
    data: images[0].data,
    mimeType: images[0].mime_type,
  };
};

// Middleware to clean up old images when updating product
const cleanupOldImages = async (imageIds) => {
  if (!imageIds || imageIds.length === 0) {
    return;
  }

  try {
    await deleteImagesFromDatabase(imageIds);
  } catch (error) {
    console.error('Error cleaning up old images:', error);
  }
};

module.exports = {
  upload: upload.array('images', 4), // Accept up to 4 images
  processImages,
  saveImagesToDatabase,
  getImagesFromDatabase,
  deleteImagesFromDatabase,
  getImageData,
  cleanupOldImages,
};

const mega = require('megajs');
const fs = require('fs');
const path = require('path');

/**
 * Uploads a file to Mega cloud storage
 * @param {string} filePath - Local file path to upload
 * @param {string} remotePath - Remote path in Mega (e.g., 'Cloud drive/app-backup/wms')
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadToMega(filePath, remotePath = 'Cloud drive/app-backup/wms') {
  return new Promise((resolve) => {
    try {
      const email = process.env.MEGA_EMAIL;
      const password = process.env.MEGA_PASSWORD;

      if (!email || !password) {
        return resolve({
          success: false,
          error: 'Mega credentials not found in environment variables. Please set MEGA_EMAIL and MEGA_PASSWORD in .env file'
        });
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return resolve({
          success: false,
          error: `File not found: ${filePath}`
        });
      }

      console.log(`[MEGA] Connecting to Mega with email: ${email}`);
      
      // Create Mega storage instance
      const storage = mega({ email, password });

      // Wait for storage to be ready
      storage.once('ready', async () => {
        try {
          console.log(`[MEGA] Connected successfully`);

          // Parse remote path and navigate/create directories
          const pathParts = remotePath.split('/').filter(Boolean);
          let currentFolder = storage.root;

          // Navigate to the target folder, creating directories if needed
          for (const folderName of pathParts) {
            let folder = currentFolder.children.find(child => 
              child.directory && child.name === folderName
            );

            if (!folder) {
              // Create folder if it doesn't exist
              console.log(`[MEGA] Creating folder: ${folderName}`);
              folder = await currentFolder.mkdir(folderName);
            }

            currentFolder = folder;
          }

          // Read file
          const fileName = path.basename(filePath);
          const fileBuffer = fs.readFileSync(filePath);
          const fileSize = fileBuffer.length;

          console.log(`[MEGA] Uploading file: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

          // Upload file to the target folder
          const file = await currentFolder.upload(fileName, fileBuffer);

          console.log(`[MEGA] ✓ Upload completed successfully`);
          console.log(`[MEGA] File URL: ${file.downloadId}`);

          resolve({
            success: true,
            fileName: fileName,
            fileSize: fileSize,
            downloadId: file.downloadId,
            url: `https://mega.nz/#!${file.downloadId}`
          });
        } catch (error) {
          console.error(`[MEGA] ✗ Upload error:`, error);
          resolve({
            success: false,
            error: error.message || 'Unknown error during Mega upload'
          });
        }
      });

      storage.once('error', (error) => {
        console.error(`[MEGA] ✗ Connection error:`, error);
        resolve({
          success: false,
          error: error.message || 'Failed to connect to Mega'
        });
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!storage.ready) {
          resolve({
            success: false,
            error: 'Mega connection timeout'
          });
        }
      }, 30000);

    } catch (error) {
      console.error(`[MEGA] ✗ Setup error:`, error);
      resolve({
        success: false,
        error: error.message || 'Unknown error during Mega setup'
      });
    }
  });
}

/**
 * Lists files in a Mega folder
 * @param {string} remotePath - Remote path in Mega
 * @returns {Promise<{success: boolean, files?: Array, error?: string}>}
 */
async function listMegaFiles(remotePath = 'Cloud drive/app-backup/wms') {
  return new Promise((resolve) => {
    try {
      const email = process.env.MEGA_EMAIL;
      const password = process.env.MEGA_PASSWORD;

      if (!email || !password) {
        return resolve({
          success: false,
          error: 'Mega credentials not found in environment variables'
        });
      }

      const storage = mega({ email, password });

      storage.once('ready', () => {
        try {
          const pathParts = remotePath.split('/').filter(Boolean);
          let currentFolder = storage.root;

          for (const folderName of pathParts) {
            const folder = currentFolder.children.find(child => 
              child.directory && child.name === folderName
            );

            if (!folder) {
              return resolve({
                success: false,
                error: `Folder not found: ${remotePath}`
              });
            }

            currentFolder = folder;
          }

          const files = currentFolder.children
            .filter(child => !child.directory)
            .map(child => ({
              name: child.name,
              size: child.size,
              downloadId: child.downloadId,
              created: child.timestamp
            }));

          resolve({
            success: true,
            files: files
          });
        } catch (error) {
          resolve({
            success: false,
            error: error.message || 'Unknown error'
          });
        }
      });

      storage.once('error', (error) => {
        resolve({
          success: false,
          error: error.message || 'Failed to connect to Mega'
        });
      });

      setTimeout(() => {
        if (!storage.ready) {
          resolve({
            success: false,
            error: 'Mega connection timeout'
          });
        }
      }, 30000);

    } catch (error) {
      resolve({
        success: false,
        error: error.message || 'Unknown error'
      });
    }
  });
}

/**
 * Deletes old files from Mega (keeps last N files)
 * @param {string} remotePath - Remote path in Mega
 * @param {number} keepCount - Number of files to keep
 * @returns {Promise<{success: boolean, deleted?: number, error?: string}>}
 */
async function cleanupOldMegaFiles(remotePath = 'Cloud drive/app-backup/wms', keepCount = 30) {
  return new Promise(async (resolve) => {
    try {
      const listResult = await listMegaFiles(remotePath);
      
      if (!listResult.success) {
        return resolve(listResult);
      }

      const files = listResult.files || [];
      
      // Sort by creation date (newest first)
      files.sort((a, b) => b.created - a.created);
      
      // Files to delete (keep the newest N files)
      const filesToDelete = files.slice(keepCount);
      
      if (filesToDelete.length === 0) {
        return resolve({
          success: true,
          deleted: 0,
          message: 'No files to delete'
        });
      }

      const email = process.env.MEGA_EMAIL;
      const password = process.env.MEGA_PASSWORD;
      const storage = mega({ email, password });

      storage.once('ready', async () => {
        try {
          const pathParts = remotePath.split('/').filter(Boolean);
          let currentFolder = storage.root;

          for (const folderName of pathParts) {
            currentFolder = currentFolder.children.find(child => 
              child.directory && child.name === folderName
            );
          }

          let deletedCount = 0;
          for (const fileInfo of filesToDelete) {
            const file = currentFolder.children.find(child => 
              !child.directory && child.downloadId === fileInfo.downloadId
            );
            
            if (file) {
              await file.delete();
              deletedCount++;
              console.log(`[MEGA] Deleted old backup: ${fileInfo.name}`);
            }
          }

          resolve({
            success: true,
            deleted: deletedCount,
            message: `Deleted ${deletedCount} old backup file(s)`
          });
        } catch (error) {
          resolve({
            success: false,
            error: error.message || 'Unknown error during cleanup'
          });
        }
      });

      storage.once('error', (error) => {
        resolve({
          success: false,
          error: error.message || 'Failed to connect to Mega'
        });
      });

      setTimeout(() => {
        if (!storage.ready) {
          resolve({
            success: false,
            error: 'Mega connection timeout'
          });
        }
      }, 30000);

    } catch (error) {
      resolve({
        success: false,
        error: error.message || 'Unknown error during cleanup'
      });
    }
  });
}

module.exports = {
  uploadToMega,
  listMegaFiles,
  cleanupOldMegaFiles
};

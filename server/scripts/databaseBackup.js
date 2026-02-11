const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { getDatabaseConfig, getDatabaseName } = require('../config/database');
const { uploadToMega, cleanupOldMegaFiles } = require('../services/megaUpload');

/**
 * Creates a backup of the MySQL database
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
async function backupDatabase() {
  return new Promise((resolve) => {
    try {
      const config = getDatabaseConfig();
      const dbName = getDatabaseName();
      
      // Create backups directory if it doesn't exist
      const backupsDir = path.join(__dirname, '../../backups');
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }

      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + 
                       '_' + new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const backupFileName = `wms_backup_${timestamp}.sql`;
      const backupFilePath = path.join(backupsDir, backupFileName);

      // Build mysqldump command
      // Note: mysqldump must be installed on the system
      let mysqldumpCmd = `mysqldump`;
      
      // Add connection parameters
      const cmd = [
        mysqldumpCmd,
        `-h${config.host}`,
        `-P${config.port}`,
        `-u${config.user}`,
        config.password ? `-p${config.password}` : '',
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--quick',
        '--lock-tables=false',
        dbName,
        `> ${backupFilePath}`
      ].filter(Boolean).join(' ');

      console.log(`[BACKUP] Starting database backup: ${backupFileName}`);
      console.log(`[BACKUP] Command: ${mysqldumpCmd} ... (password hidden)`);

      // Execute mysqldump
      exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
        if (error) {
          console.error(`[BACKUP] Error creating backup:`, error);
          resolve({
            success: false,
            error: error.message
          });
          return;
        }

        if (stderr && !stderr.includes('Warning')) {
          console.error(`[BACKUP] mysqldump stderr:`, stderr);
        }

        // Check if backup file was created and has content
        if (fs.existsSync(backupFilePath)) {
          const stats = fs.statSync(backupFilePath);
          if (stats.size > 0) {
            const originalSize = stats.size;
            console.log(`[BACKUP] SQL dump created: ${backupFileName} (${(originalSize / 1024 / 1024).toFixed(2)} MB)`);

            // Compress the backup using gzip
            console.log(`[BACKUP] Compressing backup...`);
            let finalFilePath = backupFilePath;
            let finalFileName = backupFileName;
            try {
              finalFilePath = await compressBackup(backupFilePath);
              finalFileName = path.basename(finalFilePath);
              const compressedStats = fs.statSync(finalFilePath);
              const savedPercent = ((1 - compressedStats.size / originalSize) * 100).toFixed(1);
              console.log(`[BACKUP] ✓ Compressed: ${finalFileName} (${(compressedStats.size / 1024 / 1024).toFixed(2)} MB, ${savedPercent}% smaller)`);
            } catch (compressError) {
              console.error(`[BACKUP] ✗ Compression failed, using uncompressed backup:`, compressError.message);
              // Fall back to uncompressed file
              finalFilePath = backupFilePath;
              finalFileName = backupFileName;
            }

            // Upload to Mega cloud storage
            console.log(`[BACKUP] Uploading backup to Mega...`);
            const megaResult = await uploadToMega(finalFilePath, 'Cloud drive/app-backup/wms');

            if (megaResult.success) {
              console.log(`[BACKUP] ✓ Backup uploaded to Mega successfully`);
              console.log(`[BACKUP] Mega URL: ${megaResult.url}`);

              // Cleanup old backups from Mega (keep last 30)
              console.log(`[BACKUP] Cleaning up old backups from Mega...`);
              const cleanupResult = await cleanupOldMegaFiles('Cloud drive/app-backup/wms', 30);
              if (cleanupResult.success) {
                console.log(`[BACKUP] Mega cleanup: ${cleanupResult.message || `Deleted ${cleanupResult.deleted || 0} old file(s)`}`);
              }
            } else {
              console.error(`[BACKUP] ✗ Mega upload failed: ${megaResult.error}`);
              // Still return success for local backup even if Mega upload fails
            }

            const finalStats = fs.statSync(finalFilePath);
            resolve({
              success: true,
              filePath: finalFilePath,
              fileName: finalFileName,
              size: finalStats.size,
              megaUpload: megaResult.success,
              megaUrl: megaResult.url || null,
              megaError: megaResult.error || null
            });
          } else {
            console.error(`[BACKUP] Backup file is empty`);
            resolve({
              success: false,
              error: 'Backup file is empty'
            });
          }
        } else {
          console.error(`[BACKUP] Backup file was not created`);
          resolve({
            success: false,
            error: 'Backup file was not created'
          });
        }
      });
    } catch (error) {
      console.error(`[BACKUP] Exception during backup:`, error);
      resolve({
        success: false,
        error: error.message
      });
    }
  });
}

/**
 * Cleans up old backup files, keeping only the last N days
 * @param {number} daysToKeep - Number of days of backups to keep (default: 30)
 */
async function cleanupOldBackups(daysToKeep = 30) {
  try {
    const backupsDir = path.join(__dirname, '../../backups');
    
    if (!fs.existsSync(backupsDir)) {
      return;
    }

    const files = fs.readdirSync(backupsDir);
    const now = Date.now();
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    let deletedCount = 0;
    let totalSizeFreed = 0;

    for (const file of files) {
      if (!file.endsWith('.sql') && !file.endsWith('.sql.gz')) {
        continue;
      }

      const filePath = path.join(backupsDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;

      if (fileAge > maxAge) {
        const fileSize = stats.size;
        fs.unlinkSync(filePath);
        deletedCount++;
        totalSizeFreed += fileSize;
        console.log(`[BACKUP] Deleted old backup: ${file} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      }
    }

    if (deletedCount > 0) {
      console.log(`[BACKUP] Cleanup complete: Deleted ${deletedCount} old backup(s), freed ${(totalSizeFreed / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (error) {
    console.error(`[BACKUP] Error during cleanup:`, error);
  }
}

/**
 * Compress backup file using gzip (optional)
 * @param {string} backupFilePath - Path to the backup file
 * @returns {Promise<string>} Path to compressed file
 */
async function compressBackup(backupFilePath) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const compressedPath = backupFilePath + '.gz';
    
    exec(`gzip -c "${backupFilePath}" > "${compressedPath}"`, (error) => {
      if (error) {
        reject(error);
      } else {
        // Delete original uncompressed file
        fs.unlinkSync(backupFilePath);
        resolve(compressedPath);
      }
    });
  });
}

module.exports = {
  backupDatabase,
  cleanupOldBackups,
  compressBackup
};


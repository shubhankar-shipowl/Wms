const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { getDatabaseConfig, getDatabaseName } = require('../config/database');

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
      exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
            console.log(`[BACKUP] Backup created successfully: ${backupFileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve({
              success: true,
              filePath: backupFilePath,
              fileName: backupFileName,
              size: stats.size
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
      if (!file.endsWith('.sql')) {
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


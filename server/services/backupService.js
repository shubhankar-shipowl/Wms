const cron = require('node-cron');
const { backupDatabase, cleanupOldBackups } = require('../scripts/databaseBackup');

/**
 * Initialize database backup cron job
 * Runs daily at 2:00 AM India Standard Time (IST)
 * IST is UTC+5:30, so 2:00 AM IST = 8:30 PM UTC (previous day)
 * Cron format: minute hour day month day-of-week
 * For 2 AM IST (8:30 PM UTC): '30 20 * * *'
 */
function initializeBackupCron() {
  // Schedule backup at 2:00 AM IST (8:30 PM UTC previous day)
  // Using UTC timezone: 2 AM IST = 8:30 PM UTC (20:30 UTC)
  const cronSchedule = '30 20 * * *'; // 8:30 PM UTC = 2:00 AM IST
  
  console.log('[BACKUP] Initializing daily database backup cron job');
  console.log('[BACKUP] Schedule: Daily at 2:00 AM IST (8:30 PM UTC)');
  console.log('[BACKUP] Cron expression:', cronSchedule);

  const job = cron.schedule(cronSchedule, async () => {
    console.log('[BACKUP] ========================================');
    console.log('[BACKUP] Starting scheduled database backup...');
    console.log('[BACKUP] Time:', new Date().toISOString());
    
    try {
      const result = await backupDatabase();
      
      if (result.success) {
        console.log('[BACKUP] ✓ Backup completed successfully');
        console.log('[BACKUP] File:', result.fileName);
        console.log('[BACKUP] Size:', (result.size / 1024 / 1024).toFixed(2), 'MB');
        
        // Cleanup old backups (keep last 30 days)
        await cleanupOldBackups(30);
      } else {
        console.error('[BACKUP] ✗ Backup failed:', result.error);
      }
    } catch (error) {
      console.error('[BACKUP] ✗ Backup error:', error);
    }
    
    console.log('[BACKUP] ========================================');
  }, {
    scheduled: true,
    timezone: 'UTC' // Use UTC timezone for cron scheduling
  });

  // Log when job is scheduled
  console.log('[BACKUP] Cron job scheduled:', job.running ? 'Running' : 'Stopped');
  
  return job;
}

/**
 * Run backup immediately (for testing or manual trigger)
 * @returns {Promise<{success: boolean, fileName?: string, filePath?: string, size?: number, error?: string}>}
 */
async function runBackupNow() {
  console.log('[BACKUP] Running manual backup...');
  const result = await backupDatabase();
  
  if (result.success) {
    console.log('[BACKUP] Manual backup completed:', result.fileName);
    await cleanupOldBackups(30);
  } else {
    console.error('[BACKUP] Manual backup failed:', result.error);
  }
  
  return result;
}

module.exports = {
  initializeBackupCron,
  runBackupNow
};


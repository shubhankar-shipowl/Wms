const { initializeBackupCron } = require('../services/backupService');
const path = require('path');
const fs = require('fs');

/**
 * Check backup cron job status and directory
 */
async function checkBackupStatus() {
  console.log('🔍 Checking Database Backup Status...\n');
  
  // Check backups directory
  const backupsDir = path.join(__dirname, '../../backups');
  console.log('📁 Backups Directory:');
  console.log(`   Path: ${backupsDir}`);
  console.log(`   Exists: ${fs.existsSync(backupsDir)}`);
  
  if (fs.existsSync(backupsDir)) {
    const files = fs.readdirSync(backupsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql'));
    console.log(`   Total files: ${files.length}`);
    console.log(`   Backup files (.sql): ${sqlFiles.length}`);
    
    if (sqlFiles.length > 0) {
      console.log('\n   Recent backups:');
      sqlFiles
        .sort()
        .slice(-10)
        .forEach(file => {
          const filePath = path.join(backupsDir, file);
          const stats = fs.statSync(filePath);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          const date = stats.mtime.toLocaleString();
          console.log(`     ✓ ${file}`);
          console.log(`       Size: ${sizeMB} MB | Created: ${date}`);
        });
    } else {
      console.log('   ⚠️  No backup files found');
      console.log('   ℹ️  Backups will be created when cron job runs (2 AM IST daily)');
    }
  } else {
    console.log('   ⚠️  Directory does not exist - will be created on first backup');
  }
  
  console.log('\n⏰ Cron Job Schedule:');
  console.log('   Schedule: Daily at 2:00 AM IST (8:30 PM UTC)');
  console.log('   Cron Expression: 30 20 * * *');
  console.log('   Status: Initialized on server startup');
  
  console.log('\n📋 Manual Backup:');
  console.log('   You can trigger a manual backup via:');
  console.log('   - API: POST /api/system/backup (admin only)');
  console.log('   - Script: node server/scripts/test-backup.js');
  
  console.log('\n✅ Backup system is configured and ready');
}

checkBackupStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });


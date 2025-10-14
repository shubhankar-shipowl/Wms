// Load environment variables from .env file
const path = require('path');
const fs = require('fs');

// Function to load .env file
function loadEnvFile(envPath) {
  const envFile = path.resolve(envPath);
  if (!fs.existsSync(envFile)) {
    console.warn(`Environment file not found: ${envFile}`);
    return {};
  }

  const envContent = fs.readFileSync(envFile, 'utf8');
  const envVars = {};

  envContent.split('\n').forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        envVars[key.trim()] = value;
      }
    }
  });

  return envVars;
}

// Load .env file from server directory
const envVars = loadEnvFile('./server/.env');

module.exports = {
  apps: [
    {
      name: 'wms-app',
      script: './server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 5001,
        ...envVars, // Spread all .env variables
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
        ...envVars, // Spread all .env variables for production too
      },
    },
  ],
};

const fs = require('fs');
const path = require('path');

// Basic manual env file parser to avoid requiring external npm package for simple script
const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env file is missing. Please create it first.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/^CAPACITOR_SERVER_URL\s*=\s*(.+)$/m);

if (!match || !match[1].trim()) {
  console.error('Error: CAPACITOR_SERVER_URL is not set in the .env file.');
  process.exit(1);
}

const serverUrl = match[1].trim();

const config = {
  appId: 'com.navguard.app',
  appName: 'NaviGuard',
  webDir: 'out',
  server: {
    url: serverUrl,
    cleartext: false,
    errorPath: '/error.html'
  }
};

const configPath = path.resolve(__dirname, '../capacitor.config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log(`Successfully generated capacitor.config.json pointing to: ${serverUrl}`);

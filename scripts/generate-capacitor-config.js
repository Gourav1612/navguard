const fs = require('fs');
const path = require('path');

// 1. Resolve environment file (.env.local, .env, or process.env)
let serverUrl = process.env.CAPACITOR_SERVER_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVER_URL;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^(?:CAPACITOR_SERVER_URL|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_SERVER_URL)\s*=\s*["']?([^"'\r\n]+)["']?/m);
  return match && match[1] ? match[1].trim() : null;
}

if (!serverUrl) {
  serverUrl = parseEnvFile(path.resolve(__dirname, '../.env.local')) ||
              parseEnvFile(path.resolve(__dirname, '../.env'));
}

if (!serverUrl || serverUrl.includes('localhost')) {
  console.warn('Warning: Production URL not found in .env / .env.local, using default fallback.');
  serverUrl = 'https://navguard-eight.vercel.app';
}

// Clean trailing slash
serverUrl = serverUrl.replace(/\/+$/, '');

// 2. Update capacitor.config.json
const config = {
  appId: 'com.navguard.app',
  appName: 'NaviGuard',
  webDir: 'out',
  server: {
    url: serverUrl,
    cleartext: false,
    errorPath: '/error.html'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#090a0f',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    }
  }
};

const configPath = path.resolve(__dirname, '../capacitor.config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log(`[ConfigSync] Successfully synced capacitor.config.json -> ${serverUrl}`);

// 3. Update android/app/src/main/res/values/strings.xml
const stringsPath = path.resolve(__dirname, '../android/app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  let stringsContent = fs.readFileSync(stringsPath, 'utf8');
  if (stringsContent.includes('server_base_url')) {
    stringsContent = stringsContent.replace(
      /<string name="server_base_url">[^<]*<\/string>/,
      `<string name="server_base_url">${serverUrl}</string>`
    );
  } else {
    stringsContent = stringsContent.replace(
      /<\/resources>/,
      `    <string name="server_base_url">${serverUrl}</string>\n</resources>`
    );
  }
  fs.writeFileSync(stringsPath, stringsContent, 'utf8');
  console.log(`[ConfigSync] Successfully synced strings.xml server_base_url -> ${serverUrl}`);
}


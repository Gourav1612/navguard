const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgSource = path.join(__dirname, '../public/logo.svg');
const resDir = path.join(__dirname, '../android/app/src/main/res');

const iconSizes = [
  { dir: 'mipmap-mdpi', size: 48, fgSize: 108 },
  { dir: 'mipmap-hdpi', size: 72, fgSize: 162 },
  { dir: 'mipmap-xhdpi', size: 96, fgSize: 216 },
  { dir: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
  { dir: 'mipmap-xxxhdpi', size: 192, fgSize: 432 }
];

async function generate() {
  const svgBuffer = fs.readFileSync(svgSource);

  // 1. Generate full square and round launcher icons (with dark background)
  for (const { dir, size, fgSize } of iconSizes) {
    const targetDir = path.join(resDir, dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Standard Launcher Icon
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(targetDir, 'ic_launcher.png'));

    // Round Launcher Icon (circle mask)
    const circleSvg = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff" /></svg>`
    );

    const basePng = await sharp(svgBuffer).resize(size, size).png().toBuffer();

    await sharp(basePng)
      .composite([{ input: circleSvg, blend: 'dest-in' }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher_round.png'));

    // Adaptive Foreground Icon (padded logo on transparent background)
    // In Android adaptive icons, the safe zone is the inner 66/108 (~61%)
    const innerPadding = Math.round(fgSize * 0.18);
    const innerSize = fgSize - (innerPadding * 2);

    const innerLogo = await sharp(svgBuffer)
      .resize(innerSize, innerSize)
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: fgSize,
        height: fgSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: innerLogo, top: innerPadding, left: innerPadding }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

    console.log(`Generated icons for ${dir}`);
  }

  // Update splash screen
  const splashPath = path.join(resDir, 'drawable/splash.png');
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(splashPath);
  console.log('Updated splash.png');
}

generate().catch(console.error);

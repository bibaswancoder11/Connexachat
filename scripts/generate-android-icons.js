import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Base SVG definitions
const fullIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
  <defs>
    <linearGradient id="connexaBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3B82F6" />
      <stop offset="40%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#1D4ED8" />
    </linearGradient>
  </defs>

  <rect 
    x="16" 
    y="16" 
    width="480" 
    height="480" 
    rx="140" 
    ry="140" 
    fill="url(#connexaBg)" 
  />

  <path
    d="M176 156 
       H336 
       C358.09 156 376 173.91 376 196 
       V300 
       C376 322.09 358.09 340 336 340 
       H212 
       L162 376 
       C156.4 380 148 376 148 369 
       V196 
       C148 173.91 165.91 156 188 156 Z"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="26"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
`;

// Adaptive foreground (transparent background, white speech bubble centered in safe zone)
const adaptiveForegroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
  <path
    d="M176 156 
       H336 
       C358.09 156 376 173.91 376 196 
       V300 
       C376 322.09 358.09 340 336 340 
       H212 
       L162 376 
       C156.4 380 148 376 148 369 
       V196 
       C148 173.91 165.91 156 188 156 Z"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="26"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
`;

const roundIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
  <defs>
    <linearGradient id="connexaBgRound" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3B82F6" />
      <stop offset="40%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#1D4ED8" />
    </linearGradient>
  </defs>

  <circle 
    cx="256" 
    cy="256" 
    r="240" 
    fill="url(#connexaBgRound)" 
  />

  <path
    d="M176 156 
       H336 
       C358.09 156 376 173.91 376 196 
       V300 
       C376 322.09 358.09 340 336 340 
       H212 
       L162 376 
       C156.4 380 148 376 148 369 
       V196 
       C148 173.91 165.91 156 188 156 Z"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="26"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
`;

const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <rect width="1080" height="1920" fill="#0F172A" />
  <g transform="translate(390, 810) scale(0.6)">
    <defs>
      <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3B82F6" />
        <stop offset="40%" stop-color="#2563EB" />
        <stop offset="100%" stop-color="#1D4ED8" />
      </linearGradient>
    </defs>
    <rect x="16" y="16" width="480" height="480" rx="140" ry="140" fill="url(#splashGrad)" />
    <path
      d="M176 156 H336 C358.09 156 376 173.91 376 196 V300 C376 322.09 358.09 340 336 340 H212 L162 376 C156.4 380 148 376 148 369 V196 C148 173.91 165.91 156 188 156 Z"
      fill="none"
      stroke="#FFFFFF"
      stroke-width="26"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </g>
</svg>
`;

async function generateIcons() {
  console.log('Generating Connexa Android & Web Icons...');

  // Ensure public icons exist
  await sharp(Buffer.from(fullIconSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'logo-512.png'));

  await sharp(Buffer.from(fullIconSvg))
    .resize(192, 192)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'logo-192.png'));

  // Also create base assets directory for capacitor-assets if used
  const assetsDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  await sharp(Buffer.from(fullIconSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));

  await sharp(Buffer.from(adaptiveForegroundSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon-foreground.png'));

  await sharp(Buffer.from(fullIconSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon-only.png'));

  await sharp(Buffer.from(splashSvg))
    .resize(2732, 2732)
    .png()
    .toFile(path.join(assetsDir, 'splash.png'));

  // Target android res directory
  const androidResDir = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'res');

  if (fs.existsSync(androidResDir)) {
    console.log('Targeting Android res at:', androidResDir);

    const densities = [
      { name: 'mipmap-mdpi', size: 48, fgSize: 108 },
      { name: 'mipmap-hdpi', size: 72, fgSize: 162 },
      { name: 'mipmap-xhdpi', size: 96, fgSize: 216 },
      { name: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
      { name: 'mipmap-xxxhdpi', size: 192, fgSize: 432 }
    ];

    for (const d of densities) {
      const dirPath = path.join(androidResDir, d.name);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Standard launcher icon
      await sharp(Buffer.from(fullIconSvg))
        .resize(d.size, d.size)
        .png()
        .toFile(path.join(dirPath, 'ic_launcher.png'));

      // Round launcher icon
      await sharp(Buffer.from(roundIconSvg))
        .resize(d.size, d.size)
        .png()
        .toFile(path.join(dirPath, 'ic_launcher_round.png'));

      // Adaptive foreground
      await sharp(Buffer.from(adaptiveForegroundSvg))
        .resize(d.fgSize, d.fgSize)
        .png()
        .toFile(path.join(dirPath, 'ic_launcher_foreground.png'));
    }

    // Set background color in values/ic_launcher_background.xml
    const valuesDir = path.join(androidResDir, 'values');
    if (!fs.existsSync(valuesDir)) {
      fs.mkdirSync(valuesDir, { recursive: true });
    }

    const backgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#2563EB</color>
</resources>`;

    fs.writeFileSync(path.join(valuesDir, 'ic_launcher_background.xml'), backgroundXml);

    // Also in drawable
    const drawableDir = path.join(androidResDir, 'drawable');
    if (!fs.existsSync(drawableDir)) {
      fs.mkdirSync(drawableDir, { recursive: true });
    }

    const drawableBgXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#2563EB"
        android:pathData="M0,0h108v108h-108z" />
</vector>`;

    fs.writeFileSync(path.join(drawableDir, 'ic_launcher_background.xml'), drawableBgXml);

    // Also ensure mipmap-anydpi-v26 contains proper adaptive definitions
    const anyDpiDir = path.join(androidResDir, 'mipmap-anydpi-v26');
    if (!fs.existsSync(anyDpiDir)) {
      fs.mkdirSync(anyDpiDir, { recursive: true });
    }

    const adaptiveLauncherXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>`;

    fs.writeFileSync(path.join(anyDpiDir, 'ic_launcher.xml'), adaptiveLauncherXml);
    fs.writeFileSync(path.join(anyDpiDir, 'ic_launcher_round.xml'), adaptiveLauncherXml);

    // Overwrite splash.png in drawable if present
    await sharp(Buffer.from(splashSvg))
      .resize(1080, 1920)
      .png()
      .toFile(path.join(drawableDir, 'splash.png'));

    console.log('Successfully generated all Android launcher icons (legacy + adaptive + round) & splash screen!');
  } else {
    console.log('Android res directory not found yet (will be generated during CI build).');
  }
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});

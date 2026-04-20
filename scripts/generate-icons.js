const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetsDir = path.join(__dirname, '../assets');

// ─── SVG Designs ────────────────────────────────────────────────────��────────

// Full icon: purple background + white split symbol
const svgFull = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" rx="210" fill="#6C63FF"/>
  <circle cx="512" cy="490" r="330" fill="rgba(255,255,255,0.08)"/>

  <line x1="512" y1="790" x2="512" y2="490"
        stroke="white" stroke-width="92" stroke-linecap="round"/>
  <line x1="512" y1="490" x2="268" y2="246"
        stroke="white" stroke-width="92" stroke-linecap="round"/>
  <line x1="512" y1="490" x2="756" y2="246"
        stroke="white" stroke-width="92" stroke-linecap="round"/>

  <circle cx="512" cy="490" r="56" fill="white"/>
  <circle cx="268" cy="246" r="68" fill="white"/>
  <circle cx="756" cy="246" r="68" fill="white"/>
  <circle cx="512" cy="790" r="68" fill="white"/>

  <text x="268" y="262" font-family="Helvetica, Arial, sans-serif"
        font-size="72" font-weight="900" fill="#6C63FF"
        text-anchor="middle" dominant-baseline="middle">€</text>
  <text x="756" y="262" font-family="Helvetica, Arial, sans-serif"
        font-size="72" font-weight="900" fill="#6C63FF"
        text-anchor="middle" dominant-baseline="middle">€</text>
  <text x="512" y="806" font-family="Helvetica, Arial, sans-serif"
        font-size="72" font-weight="900" fill="#6C63FF"
        text-anchor="middle" dominant-baseline="middle">$</text>
</svg>`;

// Adaptive icon foreground: transparent background, white symbol centered
// Android crops to ~66% of the image, so we scale the symbol to ~66% and center it
const svgAdaptiveFg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512,512) scale(0.62) translate(-512,-512)">
    <line x1="512" y1="790" x2="512" y2="490"
          stroke="white" stroke-width="92" stroke-linecap="round"/>
    <line x1="512" y1="490" x2="268" y2="246"
          stroke="white" stroke-width="92" stroke-linecap="round"/>
    <line x1="512" y1="490" x2="756" y2="246"
          stroke="white" stroke-width="92" stroke-linecap="round"/>

    <circle cx="512" cy="490" r="56" fill="white"/>
    <circle cx="268" cy="246" r="68" fill="white"/>
    <circle cx="756" cy="246" r="68" fill="white"/>
    <circle cx="512" cy="790" r="68" fill="white"/>

    <text x="268" y="262" font-family="Helvetica, Arial, sans-serif"
          font-size="72" font-weight="900" fill="#6C63FF"
          text-anchor="middle" dominant-baseline="middle">€</text>
    <text x="756" y="262" font-family="Helvetica, Arial, sans-serif"
          font-size="72" font-weight="900" fill="#6C63FF"
          text-anchor="middle" dominant-baseline="middle">€</text>
    <text x="512" y="806" font-family="Helvetica, Arial, sans-serif"
          font-size="72" font-weight="900" fill="#6C63FF"
          text-anchor="middle" dominant-baseline="middle">$</text>
  </g>
</svg>`;

// Favicon: simple solid purple square with white split symbol (no text, too small)
const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#6C63FF"/>
  <line x1="16" y1="26" x2="16" y2="16"
        stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="16" x2="8" y2="7"
        stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="16" x2="24" y2="7"
        stroke="white" stroke-width="3" stroke-linecap="round"/>
  <circle cx="8"  cy="7"  r="2.5" fill="white"/>
  <circle cx="24" cy="7"  r="2.5" fill="white"/>
  <circle cx="16" cy="26" r="2.5" fill="white"/>
  <circle cx="16" cy="16" r="2"   fill="white"/>
</svg>`;

// ─── Generate ─────────────────────────────────────────────────────────────────

async function generate() {
  console.log('Generating Splitivo icons...\n');

  // icon.png – 1024×1024 (App Store / iOS / Expo default)
  await sharp(Buffer.from(svgFull))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));
  console.log('✓ assets/icon.png          (1024×1024)');

  // adaptive-icon.png – 1024×1024 foreground (Android adaptive, no background)
  await sharp(Buffer.from(svgAdaptiveFg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'adaptive-icon.png'));
  console.log('✓ assets/adaptive-icon.png (1024×1024, transparent bg)');

  // favicon.png – 32×32 (Web)
  await sharp(Buffer.from(svgFavicon))
    .resize(32, 32)
    .png()
    .toFile(path.join(assetsDir, 'favicon.png'));
  console.log('✓ assets/favicon.png       (32×32)');

  // splash-icon.png – 200×200 white version for splash screen
  // (no rounded corners, white symbol on transparent, splash bg is purple)
  const svgSplashIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
    <line x1="100" y1="170" x2="100" y2="95"
          stroke="white" stroke-width="18" stroke-linecap="round"/>
    <line x1="100" y1="95" x2="48" y2="40"
          stroke="white" stroke-width="18" stroke-linecap="round"/>
    <line x1="100" y1="95" x2="152" y2="40"
          stroke="white" stroke-width="18" stroke-linecap="round"/>
    <circle cx="48"  cy="40"  r="14" fill="white"/>
    <circle cx="152" cy="40"  r="14" fill="white"/>
    <circle cx="100" cy="170" r="14" fill="white"/>
    <circle cx="100" cy="95"  r="10" fill="white"/>
  </svg>`;

  await sharp(Buffer.from(svgSplashIcon))
    .resize(200, 200)
    .png()
    .toFile(path.join(assetsDir, 'splash-icon.png'));
  console.log('✓ assets/splash-icon.png   (200×200, white on transparent)');

  console.log('\nAll icons generated successfully!');
}

generate().catch((err) => {
  console.error('Error generating icons:', err.message);
  process.exit(1);
});

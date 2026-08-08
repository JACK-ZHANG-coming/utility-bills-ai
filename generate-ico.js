const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'icon-1024x1024.png');

const sizes = [16, 32, 48];

async function generate() {
  // Generate individual PNG buffers for each size
  const buffers = [];
  for (const size of sizes) {
    const buf = await sharp(src)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    buffers.push(buf);
    console.log(`Resized to ${size}x${size}`);
  }

  // Create multi-size .ico
  const icoBuf = await toIco(buffers);
  fs.writeFileSync(path.join(__dirname, 'favicon.ico'), icoBuf);
  console.log('Generated favicon.ico (16x16 + 32x32 + 48x48)');

  // Also regenerate all PNG favicons
  const pngSizes = [
    { size: 16, name: 'favicon-16x16.png' },
    { size: 32, name: 'favicon-32x32.png' },
    { size: 64, name: 'favicon-64x64.png' },
    { size: 96, name: 'favicon-96x96.png' },
    { size: 180, name: 'apple-touch-icon.png' },
    { size: 192, name: 'icon-192x192.png' },
    { size: 512, name: 'icon-512x512.png' },
  ];

  for (const { size, name } of pngSizes) {
    await sharp(src)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(__dirname, name));
    console.log(`Generated ${name} (${size}x${size})`);
  }

  console.log('\nDone! All icons generated.');
}

generate().catch(console.error);

const sharp = require('sharp');
const fs = require('fs');

const SOURCE = '/Users/zhangqiang/Documents/GitHub/utility-bills-ai/A_clean__minimal_app_icon_for__2026-08-08T06-33-17.png';
const OUT_DIR = '/Users/zhangqiang/Documents/GitHub/utility-bills-ai';

const sizes = [
  { w: 512, h: 512, name: 'icon-512x512.png' },
  { w: 192, h: 192, name: 'icon-192x192.png' },
  { w: 180, h: 180, name: 'apple-touch-icon.png' },
  { w: 96,  h: 96,  name: 'favicon-96x96.png' },
  { w: 64,  h: 64,  name: 'favicon-64x64.png' },
  { w: 32,  h: 32,  name: 'favicon-32x32.png' },
  { w: 16,  h: 16,  name: 'favicon-16x16.png' },
];

async function generate() {
  for (const s of sizes) {
    await sharp(SOURCE)
      .resize(s.w, s.h, { fit: 'cover', position: 'center' })
      .png({ quality: 95 })
      .toFile(`${OUT_DIR}/${s.name}`);
    console.log(`✓ ${s.name}`);
  }
  console.log('Done!');
}

generate().catch(e => { console.error(e); process.exit(1); });

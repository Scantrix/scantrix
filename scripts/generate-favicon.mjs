import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'docs');

const svgPath = join(docsDir, 'high-res-icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [64, 48, 32, 16];

async function main() {
  // Generate PNGs at each size
  const pngBuffers = {};
  for (const size of sizes) {
    const outPath = join(docsDir, `icon-${size}x${size}.png`);
    const buf = await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    writeFileSync(outPath, buf);
    pngBuffers[size] = buf;
    console.log(`Created icon-${size}x${size}.png (${buf.length} bytes)`);
  }

  // Build ICO file (PNG-based ICO format)
  // ICO structure:
  //   ICONDIR: 6 bytes (reserved:2, type:2, count:2)
  //   ICONDIRENTRY[]: 16 bytes each (width:1, height:1, colors:1, reserved:1, planes:2, bpp:2, size:4, offset:4)
  //   Image data: PNG buffers concatenated

  const numImages = sizes.length;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * numImages;

  // Calculate offsets for each image
  let currentOffset = dataOffset;
  const entries = [];
  for (const size of sizes) {
    const buf = pngBuffers[size];
    entries.push({
      width: size === 256 ? 0 : size,  // 0 means 256 in ICO format
      height: size === 256 ? 0 : size,
      buf,
      offset: currentOffset,
    });
    currentOffset += buf.length;
  }

  // Total file size
  const totalSize = currentOffset;
  const ico = Buffer.alloc(totalSize);

  // Write ICONDIR header
  ico.writeUInt16LE(0, 0);           // Reserved, must be 0
  ico.writeUInt16LE(1, 2);           // Type: 1 = ICO
  ico.writeUInt16LE(numImages, 4);   // Number of images

  // Write ICONDIRENTRY for each image
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const pos = headerSize + i * entrySize;
    ico.writeUInt8(e.width, pos);       // Width
    ico.writeUInt8(e.height, pos + 1);  // Height
    ico.writeUInt8(0, pos + 2);         // Color palette (0 = no palette)
    ico.writeUInt8(0, pos + 3);         // Reserved
    ico.writeUInt16LE(1, pos + 4);      // Color planes
    ico.writeUInt16LE(32, pos + 6);     // Bits per pixel
    ico.writeUInt32LE(e.buf.length, pos + 8);   // Image data size
    ico.writeUInt32LE(e.offset, pos + 12);      // Offset to image data
  }

  // Write image data
  for (const e of entries) {
    e.buf.copy(ico, e.offset);
  }

  const icoPath = join(docsDir, 'favicon.ico');
  writeFileSync(icoPath, ico);
  console.log(`Created favicon.ico (${ico.length} bytes) with ${numImages} sizes: ${sizes.join(', ')}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

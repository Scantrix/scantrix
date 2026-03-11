/**
 * generate-favicons.ts
 *
 * Converts per-size SVG favicons in docs/ into PNGs and combines
 * the small sizes into a favicon.ico.
 *
 * Usage:  npx ts-node scripts/generate-favicons.ts
 * Output: docs/favicons/
 */

import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const OUT_DIR = path.join(ROOT, "docs", "favicons");

interface SizeSpec {
  size: number;
  svgFilename: string;
  pngFilename: string;
}

const sizes: SizeSpec[] = [
  { size: 16, svgFilename: "favicon-16.svg", pngFilename: "favicon-16.png" },
  { size: 32, svgFilename: "favicon-32.svg", pngFilename: "favicon-32.png" },
  { size: 48, svgFilename: "favicon-48.svg", pngFilename: "favicon-48.png" },
  { size: 64, svgFilename: "favicon-64.svg", pngFilename: "favicon-64.png" },
];

/** Build a favicon.ico from multiple PNG buffers (ICO container format). */
function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const HEADER_SIZE = 6;
  const DIR_ENTRY_SIZE = 16;
  const count = pngs.length;

  // Calculate offsets
  let dataOffset = HEADER_SIZE + count * DIR_ENTRY_SIZE;
  const entries: { size: number; data: Buffer; offset: number }[] = [];
  for (const png of pngs) {
    entries.push({ size: png.size, data: png.data, offset: dataOffset });
    dataOffset += png.data.length;
  }

  const totalSize = dataOffset;
  const buf = Buffer.alloc(totalSize);

  // ICO header: reserved(2) + type(2) + count(2)
  buf.writeUInt16LE(0, 0);       // reserved
  buf.writeUInt16LE(1, 2);       // type = 1 (ICO)
  buf.writeUInt16LE(count, 4);   // image count

  // Directory entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = HEADER_SIZE + i * DIR_ENTRY_SIZE;
    buf.writeUInt8(e.size < 256 ? e.size : 0, off);       // width (0 = 256)
    buf.writeUInt8(e.size < 256 ? e.size : 0, off + 1);   // height
    buf.writeUInt8(0, off + 2);                             // color palette
    buf.writeUInt8(0, off + 3);                             // reserved
    buf.writeUInt16LE(1, off + 4);                          // color planes
    buf.writeUInt16LE(32, off + 6);                         // bits per pixel
    buf.writeUInt32LE(e.data.length, off + 8);              // data size
    buf.writeUInt32LE(e.offset, off + 12);                  // data offset
  }

  // Image data
  for (const e of entries) {
    e.data.copy(buf, e.offset);
  }

  return buf;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const pngBuffers: { size: number; data: Buffer }[] = [];

  for (const spec of sizes) {
    const svgPath = path.join(DOCS_DIR, spec.svgFilename);
    const svgBuffer = await fs.readFile(svgPath);

    const pngData = await sharp(svgBuffer, { density: 400 })
      .resize(spec.size, spec.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    await fs.writeFile(path.join(OUT_DIR, spec.pngFilename), pngData);
    console.log(`  ${spec.pngFilename} (${spec.size}x${spec.size})`);

    pngBuffers.push({ size: spec.size, data: pngData });
  }

  // Build favicon.ico from all sizes
  const icoData = buildIco(pngBuffers);
  await fs.writeFile(path.join(OUT_DIR, "favicon.ico"), icoData);
  console.log(`  favicon.ico (${pngBuffers.map(p => p.size).join("+")})`);

  console.log(`\nAll favicons written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

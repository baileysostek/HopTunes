const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '..', 'resources');
const svgPath = path.join(resourcesDir, 'icon.svg');

function createIco(pngBuffers) {
  const count = pngBuffers.length;
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: 1 = ICO
  header.writeUInt16LE(count, 4); // image count

  // Directory entries: 16 bytes each
  const dirEntries = [];
  let dataOffset = 6 + count * 16;

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);  // height (0 = 256)
    entry.writeUInt8(0, 2);                         // color palette
    entry.writeUInt8(0, 3);                         // reserved
    entry.writeUInt16LE(1, 4);                      // color planes
    entry.writeUInt16LE(32, 6);                     // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);          // image data size
    entry.writeUInt32LE(dataOffset, 12);            // offset to image data
    dirEntries.push(entry);
    dataOffset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map(p => p.buffer)]);
}

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  // Generate PNGs at various sizes
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngBuffers = {};

  for (const size of sizes) {
    const png = await sharp(svgBuffer).resize(size, size).png().toBuffer();
    pngBuffers[size] = png;
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(resourcesDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }

  // Main icon.png at 512
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(resourcesDir, 'icon.png'));
  console.log('Generated icon.png (512x512)');

  // Generate .ico (embed PNGs directly)
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoImages = icoSizes.map(size => ({ size, buffer: pngBuffers[size] }));
  const icoBuffer = createIco(icoImages);
  fs.writeFileSync(path.join(resourcesDir, 'icon.ico'), icoBuffer);
  console.log('Generated icon.ico');

  console.log('\nAll icons generated in resources/');
}

generateIcons().catch(console.error);

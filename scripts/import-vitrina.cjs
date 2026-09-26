// Extract the supplied GLB without changing geometry, materials or texture bytes.
// Usage: node scripts/import-vitrina.cjs path/to/Витрина_1.glb
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.argv[2]) throw Error('Provide the source GLB path.');
const source = fs.readFileSync(process.argv[2]);
assert.equal(source.toString('ascii', 0, 4), 'glTF');
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length, 'Incomplete GLB');
assert.equal(source.readUInt32LE(16), 0x4e4f534a);
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
const binHeader = 20 + jsonLength;
assert.equal(source.readUInt32LE(binHeader + 4), 0x004e4942);
const bin = source.subarray(binHeader + 8);
assert.equal(bin.length, source.readUInt32LE(binHeader));
assert.equal(gltf.buffers.length, 1);
assert.ok(!gltf.buffers[0].uri);
const output = path.join(__dirname, '..', 'models', 'vitrina-1');
fs.mkdirSync(path.join(output, 'textures'), {recursive: true});
const oldViews = gltf.bufferViews;
function bytes(view) {
  assert.equal(view.buffer, 0);
  const start = view.byteOffset || 0;
  assert.ok(start + view.byteLength <= bin.length);
  return bin.subarray(start, start + view.byteLength);
}
const imageViews = new Set();
gltf.images.forEach((image, index) => {
  assert.ok(Number.isInteger(image.bufferView));
  const extension = {'image/png': 'png', 'image/jpeg': 'jpg'}[image.mimeType];
  assert.ok(extension, 'Unexpected image format');
  imageViews.add(image.bufferView);
  const uri = `textures/texture-${index}.${extension}`;
  fs.writeFileSync(path.join(output, uri), bytes(oldViews[image.bufferView]));
  image.uri = uri;
  delete image.bufferView;
});
const remap = new Map(), views = [], chunks = [];
let offset = 0;
oldViews.forEach((view, index) => {
  if (imageViews.has(index)) return;
  const padding = (4 - offset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  remap.set(index, views.length);
  views.push({...view, buffer: 0, byteOffset: offset});
  chunks.push(bytes(view));
  offset += view.byteLength;
});
gltf.bufferViews = views;
function remapReferences(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'bufferView') {
      assert.ok(remap.has(child), 'Reference to an extracted image buffer');
      value[key] = remap.get(child);
    } else remapReferences(child);
  }
}
remapReferences(gltf);
const geometry = Buffer.concat(chunks);
gltf.buffers = [{uri: 'scene.bin', byteLength: geometry.length}];
fs.writeFileSync(path.join(output, 'scene.bin'), geometry);
fs.writeFileSync(path.join(output, 'scene.gltf'), JSON.stringify(gltf));
console.log(`Imported ${gltf.meshes.length} meshes and ${gltf.images.length} textures to ${output}`);

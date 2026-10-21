import { zip, strToU8 } from 'fflate';

// Store editable blob data as files, rather than serialising Blobs to empty JSON objects.
export async function exportProjectArchive(record) {
  const files = {}; let index = 0;
  async function encode(value) {
    if (value instanceof Blob) {
      const file = `data/${String(++index).padStart(4, '0')}.png`;
      files[file] = [new Uint8Array(await value.arrayBuffer()), { level: 0 }];
      return { file, type: value.type, bytes: value.size };
    }
    if (Array.isArray(value)) return Promise.all(value.map(encode));
    if (value && typeof value === 'object') {
      const output = {};
      for (const [key, child] of Object.entries(value)) if (key !== 'url') output[key] = await encode(child);
      return output;
    }
    return value;
  }
  files['project.json'] = strToU8(JSON.stringify({ format: 'frame-studio-project', version: 1, record: await encode(record) }, null, 2));
  return new Promise((resolve, reject) => zip(files, (error, bytes) => error ? reject(error) : resolve(new Blob([bytes], { type: 'application/zip' }))));
}

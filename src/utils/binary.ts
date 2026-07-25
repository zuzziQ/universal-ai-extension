// Binary Utilities for Processing Images in Extensions background service worker

// Custom CRC32 Generator matching Python's zlib.crc32
export function calculateCRC32(bytes: Uint8Array): string {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

// Fast Binary dimension parsing for PNG/JPEG (matches Sếp's _read_image_dims)
export function getImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  
  // PNG Magic bytes
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width, height };
  }

  // JPEG Magic bytes
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2, false);
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        return { width, height };
      }
      offset += 2 + length;
    }
  }

  return { width: 1024, height: 1024 }; // Fallback
}

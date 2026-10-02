// Small byte helpers that work the same in the browser and in Node.

export function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function bytesToDataUri(bytes, contentType) {
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes) {
  return bytes.length > 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Reads width and height straight from a PNG's IHDR header (no decoding). */
export function pngSize(bytes) {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

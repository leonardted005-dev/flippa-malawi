import type { ImageInspection } from '@fa/domain';

const PROBE_BYTES = 65_536;

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.toString('latin1', start, start + length);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function isGif(buffer: Buffer): boolean {
  const header = ascii(buffer, 0, 6);
  return header === 'GIF89a' || header === 'GIF87a';
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length > 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP';
}

function pngDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length < 24) {
    return {};
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length < 10) {
    return {};
  }
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function jpegDimensions(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    // SOF0..SOF15 excluding DHT(D4), JPG(C8), DAC(CC)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return {};
}

function webpDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length < 30) {
    return {};
  }
  const chunk = ascii(buffer, 12, 4);
  const subchunk = ascii(buffer, 20, 4);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + (buffer[26]! | (buffer[27]! << 8) | (buffer[28]! << 16));
    const height = 1 + (buffer[29]! | (buffer[30]! << 8) | (buffer[31]! << 16));
    return { width, height };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && subchunk === 'VP8 ') {
    // Lossy: 3-byte frame tag, 3-byte sync, then 14-bit start-code dimensions.
    return { width: buffer.readUInt16LE(27) & 0x3fff, height: buffer.readUInt16LE(29) & 0x3fff };
  }
  return {};
}

/**
 * Sniffs magic bytes of a bounded header slice (never the whole object) to
 * detect the REAL image format and dimensions. The client's declared
 * Content-Type is never trusted on its own.
 */
export function probeImage(header: Buffer): ImageInspection | null {
  const buffer = header.subarray(0, PROBE_BYTES);

  if (isJpeg(buffer)) {
    const { width, height } = jpegDimensions(buffer);
    return { format: 'jpeg', width, height };
  }
  if (isPng(buffer)) {
    const { width, height } = pngDimensions(buffer);
    return { format: 'png', width, height };
  }
  if (isGif(buffer)) {
    const { width, height } = gifDimensions(buffer);
    return { format: 'gif', width, height };
  }
  if (isWebp(buffer)) {
    const { width, height } = webpDimensions(buffer);
    return { format: 'webp', width, height };
  }
  return null;
}

export { PROBE_BYTES };

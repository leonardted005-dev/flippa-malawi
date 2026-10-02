import { probeImage } from './image-probe';

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function gif(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(14);
  buffer.write('GIF89a', 0, 'latin1');
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

function jpeg(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt16BE(0xffd8, 0);
  buffer.writeUInt16BE(0xffc0, 2);
  buffer.writeUInt16BE(0x0011, 4);
  buffer.writeUInt8(8, 6);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

describe('probeImage', () => {
  it('detects PNG magic bytes and reads IHDR dimensions', () => {
    const result = probeImage(png(1280, 720));
    expect(result).toEqual({ format: 'png', width: 1280, height: 720 });
  });

  it('detects GIF dimensions', () => {
    expect(probeImage(gif(640, 480))).toEqual({ format: 'gif', width: 640, height: 480 });
  });

  it('detects JPEG SOF dimensions', () => {
    expect(probeImage(jpeg(1024, 512))).toEqual({ format: 'jpeg', width: 1024, height: 512 });
  });

  it('rejects bytes that are not a supported image (no trusting Content-Type)', () => {
    expect(probeImage(Buffer.from('<?php echo "not an image"; ?>'))).toBeNull();
    expect(probeImage(Buffer.from('RIFFxxxxWAVE'))).toBeNull();
  });
});

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { validateImage, validateTarget } from './image-validation';
import { UploadFile, UploadTarget } from './upload.types';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

describe('GEN-08 actual image content and input validation', () => {
  let png: Buffer;
  let jpeg: Buffer;
  const file = (buffer: Buffer, mimetype = 'image/png'): UploadFile => ({
    buffer,
    size: buffer.length,
    mimetype,
  });
  beforeAll(async () => {
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    jpeg = await sharp(png).jpeg().toBuffer();
  });
  it.each(['png', 'jpeg'])(
    'decodes a real %s while preserving original bytes',
    async (format) => {
      const buffer = format === 'png' ? png : jpeg;
      const image = await validateImage(file(buffer, `image/${format}`));
      expect(image.buffer).toEqual(buffer);
      expect(image.buffer).not.toBe(buffer);
      expect(image.extension).toBe(format === 'png' ? 'png' : 'jpg');
    },
  );
  it('accepts exactly the shared 5 MiB boundary and rejects one byte over', async () => {
    // Legal JPEG comment segments grow a decodable file to the exact boundary.
    const limit = 5 * 1024 * 1024;
    let remaining = limit - jpeg.length;
    const segments: Buffer[] = [jpeg.subarray(0, 2)];
    while (remaining > 0) {
      const size = Math.min(remaining, 65537);
      const segment = Buffer.alloc(size, 32);
      segment[0] = 255;
      segment[1] = 254;
      segment.writeUInt16BE(size - 2, 2);
      segments.push(segment);
      remaining -= size;
    }
    segments.push(jpeg.subarray(2));
    const exact = Buffer.concat(segments);
    expect(exact.length).toBe(limit);
    await expect(
      validateImage(file(exact, 'image/jpeg')),
    ).resolves.toMatchObject({ extension: 'jpg' });
    await expect(
      validateImage(
        file(Buffer.concat([exact, Buffer.from([0])]), 'image/jpeg'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    ['GIF', Buffer.from('GIF89a'), 'image/gif'],
    ['PDF', Buffer.from('%PDF-1.7'), 'application/pdf'],
    ['disguised text', Buffer.from('not an image'), 'image/png'],
    [
      'PNG signature without pixels',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      'image/png',
    ],
    [
      'JPEG signature without pixels',
      Buffer.from([255, 216, 255, 224, 0, 16]),
      'image/jpeg',
    ],
  ])('rejects %s', async (_label, buffer, mime) => {
    await expect(validateImage(file(buffer, mime))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('rejects truncated image data, MIME mismatch and unsupported MIME', async () => {
    for (const candidate of [
      file(png.subarray(0, 40)),
      file(png, 'image/jpeg'),
      file(jpeg, 'image/png'),
      file(png, 'text/plain'),
    ])
      await expect(validateImage(candidate)).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
  it('rejects missing, malformed, empty and inconsistent upload input', async () => {
    for (const candidate of [
      undefined,
      null,
      {},
      { buffer: 'text', size: 4, mimetype: 'image/png' },
      file(Buffer.alloc(0)),
      { ...file(png), size: png.length - 1 },
    ])
      await expect(
        validateImage(candidate as UploadFile),
      ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('limits decoded pixels even for a small compressed file', async () => {
    const large = await sharp({
      create: { width: 4500, height: 4500, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(validateImage(file(large))).rejects.toThrow(
      'decoding resource limits',
    );
  });
  it('publishes four kinds, preserves entity IDs and normalizes ObjectId case', () => {
    for (const kind of ['post', 'activity', 'hotel', 'airline'] as const)
      expect(validateTarget({ kind, ownerId: 'entity_123' })).toEqual({
        kind,
        ownerId: 'entity_123',
      });
    expect(
      validateTarget({ kind: 'post', ownerId: 'ABCDEF012345ABCDEF012345' })
        .ownerId,
    ).toBe('abcdef012345abcdef012345');
  });
  it.each([
    undefined,
    null,
    {},
    { kind: 'user', ownerId: 'one' },
    { kind: 'post', ownerId: '' },
    { kind: 'hotel', ownerId: '../../secret' },
    { kind: 'post', ownerId: 42 },
    { kind: 'post', ownerId: 'x'.repeat(101) },
  ])('rejects malformed entity metadata %#', (value) => {
    expect(() => validateTarget(value as UploadTarget)).toThrow(
      BadRequestException,
    );
  });
});

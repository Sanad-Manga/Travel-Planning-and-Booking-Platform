import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { IMAGE_ALLOWED_MIME_TYPES, IMAGE_MAX_BYTES } from '../common';
import { UploadFile, UPLOAD_KINDS, UploadTarget } from './upload.types';

export function validateTarget(target: UploadTarget): UploadTarget {
  if (
    !target ||
    !UPLOAD_KINDS.includes(target.kind) ||
    typeof target.ownerId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(target.ownerId)
  ) {
    throw new BadRequestException('Invalid upload kind or entity identifier');
  }
  return {
    kind: target.kind,
    ownerId: /^[a-f0-9]{24}$/i.test(target.ownerId)
      ? target.ownerId.toLowerCase()
      : target.ownerId,
  };
}

export async function validateImage(
  file: UploadFile,
): Promise<{ buffer: Buffer; contentType: string; extension: 'jpg' | 'png' }> {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    !file.buffer.length ||
    file.buffer.length > IMAGE_MAX_BYTES ||
    file.size !== file.buffer.length ||
    !IMAGE_ALLOWED_MIME_TYPES.includes(
      file.mimetype as (typeof IMAGE_ALLOWED_MIME_TYPES)[number],
    )
  ) {
    throw new BadRequestException(
      'Provide a nonempty JPEG or PNG image of at most 5 MB',
    );
  }
  // Copy before asynchronous decoding: the caller cannot mutate bytes after validation.
  const buffer = Buffer.from(file.buffer);
  const png = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if ((!png && !jpeg) || file.mimetype !== (png ? 'image/png' : 'image/jpeg'))
    throw new BadRequestException('Image content does not match its MIME type');
  try {
    const decoder = sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: 20_000_000,
    });
    const metadata = await decoder.metadata();
    if (metadata.format !== (png ? 'png' : 'jpeg')) throw new Error();
    // Force pixel decoding, not just a metadata/signature check. No resize or re-encoding.
    await decoder.timeout({ seconds: 5 }).raw().toBuffer();
  } catch {
    throw new BadRequestException(
      'Image is malformed or exceeds decoding resource limits',
    );
  }
  return {
    buffer,
    contentType: png ? 'image/png' : 'image/jpeg',
    extension: png ? 'png' : 'jpg',
  };
}

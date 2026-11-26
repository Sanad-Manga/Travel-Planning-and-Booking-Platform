'use client';

import Image from 'next/image';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { Alert } from './Alert';
import { useConfirm } from './ConfirmProvider';

const MIME_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;

export interface ImageReference {
  id: string;
  url: string;
}

export interface ImageUploaderProps {
  images: readonly ImageReference[];
  onChange: (update: (images: readonly ImageReference[]) => ImageReference[]) => void;
  upload: (file: File) => Promise<ImageReference>;
  remove: (image: ImageReference) => Promise<void>;
  maxImages?: number;
  label?: string;
  disabled?: boolean;
}

function selectionError(files: File[], remaining: number) {
  if (files.length > remaining) {
    return remaining <= 0
      ? 'Remove an image before adding another.'
      : `Choose at most ${remaining} more ${remaining === 1 ? 'image' : 'images'}.`;
  }

  for (const file of files) {
    if (!MIME_TYPES.includes(file.type)) return `${file.name} must be a JPG or PNG image.`;
    if (!file.size) return `${file.name} is empty. Choose another image.`;
    if (file.size > MAX_BYTES) return `${file.name} is larger than 5 MB.`;
  }
}

function failureMessage(error: unknown) {
  return error instanceof ApiError ? error.message : toFriendlyError(error).message;
}

export function ImageUploader({
  images, onChange, upload, remove, maxImages = 5, label = 'Images', disabled = false,
}: ImageUploaderProps) {
  const inputId = useId();
  const confirm = useConfirm();
  const locked = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (disabled || locked.current || !files.length) return;

    const invalid = selectionError(files, maxImages - images.length);
    setError(invalid);
    if (invalid) return;

    locked.current = true;
    try {
      for (const [index, file] of files.entries()) {
        setPending(`Uploading image ${index + 1} of ${files.length}…`);
        const uploaded = await upload(file);
        onChange((current) => [...current, uploaded]);
      }
    } catch (error) {
      setError(failureMessage(error));
    } finally {
      locked.current = false;
      setPending(undefined);
    }
  }

  async function deleteImage(image: ImageReference) {
    if (disabled || locked.current) return;
    locked.current = true;
    try {
      await confirm({
        title: 'Delete this image?',
        message: 'This removes the image from the item.',
        confirmLabel: 'Delete image',
        destructive: true,
        onConfirm: async () => {
          setError(undefined);
          setPending('Deleting image…');
          await remove(image);
          onChange((current) => current.filter(({ id }) => id !== image.id));
        },
      });
    } catch (error) {
      setError(failureMessage(error));
    } finally {
      locked.current = false;
      setPending(undefined);
    }
  }

  const controlsDisabled = disabled || Boolean(pending);
  return (
    <div className="image-uploader">
      <label htmlFor={inputId}>{label}</label>
      <p id={`${inputId}-instructions`} className="image-uploader-instructions">
        JPG or PNG, up to 5 MB each. {images.length} of {maxImages} uploaded.
      </p>
      <input
        id={inputId}
        className="field-input image-uploader-input"
        type="file"
        accept={MIME_TYPES.join(',')}
        multiple={maxImages > 1}
        aria-describedby={`${inputId}-instructions`}
        disabled={controlsDisabled}
        onChange={(event) => void selectFiles(event)}
      />
      {pending ? <p role="status">{pending}</p> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {images.length > 0 ? (
        <ul className="image-uploader-grid" aria-label={`${label} previews`}>
          {images.map((image, index) => (
            <li key={image.id}>
              <Image src={image.url} alt={`${label} preview ${index + 1}`} width={320} height={240} unoptimized />
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Delete image ${index + 1} from ${label}`}
                disabled={controlsDisabled}
                onClick={() => void deleteImage(image)}
              >
                Delete image
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { api } from '@/lib/api';
import type { ImageReference } from '@/components/ImageUploader';
import type { ResponseOf } from './types';

type ImageKind = 'post' | 'hotel' | 'airline' | 'activity';

export interface UploadImageEndpoint {
  kind: ImageKind;
  id: string;
}

export type RemoveImageEndpoint =
  | { kind: 'airline'; id: string }
  | { kind: Exclude<ImageKind, 'airline'>; id: string; imageId: string };

type StandaloneImage = ResponseOf<
  '/api/posts/{id}/images' | '/api/hotels/{id}/photos' | '/api/airlines/{id}/logo',
  'post'
>;
type UpdatedActivity = ResponseOf<'/api/activities/{id}/images', 'post'>;

const imageRoutes = {
  post: ['posts', 'images'],
  hotel: ['hotels', 'photos'],
  airline: ['airlines', 'logo'],
  activity: ['activities', 'images'],
} as const satisfies Record<ImageKind, readonly [string, string]>;

function encodeId(id: string): string {
  // URL parsers resolve dot segments, and encodeURIComponent leaves dots intact.
  if (id === '' || id === '.' || id === '..') throw new Error('Invalid image route identifier.');
  return encodeURIComponent(id);
}

function imagePath({ kind, id }: UploadImageEndpoint): string {
  const [collection, resource] = imageRoutes[kind];
  return `/api/${collection}/${encodeId(id)}/${resource}`;
}

function isImageReference(value: unknown): value is ImageReference {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string' && value.id.trim() !== ''
    && 'url' in value && typeof value.url === 'string'
    && value.url.startsWith('/uploads/') && value.url.slice('/uploads/'.length).trim() !== '';
}

/** Sends one image using the shared cookie client and its standard 401 refresh policy. */
export async function uploadImage(endpoint: UploadImageEndpoint, file: File, signal?: AbortSignal): Promise<ImageReference> {
  const path = imagePath(endpoint);
  const body = new FormData();
  body.append('image', file);
  const options = { method: 'POST', body, signal } as const;

  if (endpoint.kind !== 'activity') return api<StandaloneImage>(path, options);

  const activity = await api<UpdatedActivity>(path, options);
  // The activity service appends the new reference and returns the updated activity.
  const images = activity?.images;
  const appended: unknown = Array.isArray(images) ? images.at(-1) : undefined;
  if (!isImageReference(appended)) {
    throw new Error('The upload response did not identify the new activity image. Reload the activity before trying again.');
  }
  return appended;
}

/** Airline logos are removed by airline ID. Other routes also require an image ID. */
export async function removeImage(endpoint: RemoveImageEndpoint, signal?: AbortSignal): Promise<void> {
  const path = imagePath(endpoint);
  const url = endpoint.kind === 'airline' ? path : `${path}/${encodeId(endpoint.imageId)}`;
  await api(url, { method: 'DELETE', signal });
}

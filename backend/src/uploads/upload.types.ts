export const UPLOAD_KINDS = ['post', 'activity', 'hotel', 'airline'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** A buffered multipart file. Paths and original filenames are never used. */
export interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** ownerId is the target entity ID, not the authenticated user's ID. */
export interface UploadTarget {
  kind: UploadKind;
  ownerId: string;
}

export interface UploadReference {
  id: string;
  url: string;
}

import { resolve } from 'node:path';

export const UPLOAD_OPTIONS = Symbol('UPLOAD_OPTIONS');
export interface UploadOptions {
  root: string;
  leaseMs: number;
  recoveryIntervalMs: number;
  recoveryBatchSize: number;
}

export function uploadOptions(): UploadOptions {
  return {
    root: resolve(
      process.env.UPLOAD_STORAGE_ROOT || resolve(process.cwd(), 'uploads'),
    ),
    leaseMs: 60_000,
    recoveryIntervalMs: 30_000,
    recoveryBatchSize: 50,
  };
}

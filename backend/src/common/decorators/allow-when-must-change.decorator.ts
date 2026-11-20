import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_MUST_CHANGE = 'allowWhenMustChange';
/** Explicit opt-in for password replacement, me and logout only. New routes deny by default. */
export const AllowWhenMustChange = () =>
  SetMetadata(ALLOW_WHEN_MUST_CHANGE, true);

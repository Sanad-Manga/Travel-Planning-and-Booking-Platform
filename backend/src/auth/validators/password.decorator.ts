import { IsString, Matches, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common';
import { PASSWORD_MAX_BYTES } from '../auth.constants';
import { MaxByteLength } from './max-byte-length.decorator';

/**
 * THE password rule of the platform (docs/contracts.md section 4), in one place:
 * at least 8 characters, at least one letter, at least one digit, at most 72 bytes (bcrypt's limit).
 *
 * Reused by registration (ACC-01), change password (ACC-08) and the admin temporary-password reset (ACC-07a).
 * Do not copy these rules into another DTO: put `@IsValidPassword()` on the property instead.
 * Each broken rule is its own field-level error, and the messages use the property's own name
 * ("password must ...", "newPassword must ...").
 */
export function IsValidPassword(): PropertyDecorator {
  return (target, propertyKey) => {
    const name = String(propertyKey);
    const rules: PropertyDecorator[] = [
      IsString(),
      MinLength(PASSWORD_MIN_LENGTH, { message: `${name} must be at least ${PASSWORD_MIN_LENGTH} characters` }),
      // bcrypt only uses the first 72 BYTES, so a longer password would silently be truncated. Bytes, not characters.
      MaxByteLength(PASSWORD_MAX_BYTES, {
        message: `${name} is too long (maximum ${PASSWORD_MAX_BYTES} bytes; non-English characters use 2 or more bytes each)`,
      }),
      // \p{L} = any Unicode letter (Latin, Arabic, ...); the `u` flag makes JavaScript understand \p{...}.
      Matches(/\p{L}/u, { message: `${name} must contain at least one letter` }),
      Matches(/\d/, { message: `${name} must contain at least one digit` }),
    ];
    for (const rule of rules) rule(target, propertyKey);
  };
}

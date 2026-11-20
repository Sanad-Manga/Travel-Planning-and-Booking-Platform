import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Like @MaxLength, but counts UTF-8 bytes instead of characters. "a" is 1 byte, an Arabic letter is 2,
 * so a short-looking string can still be longer than a byte limit. Non-strings fail (pair it with @IsString).
 */
export function MaxByteLength(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'maxByteLength',
      target: target.constructor,
      propertyName: propertyKey as string,
      constraints: [max],
      options: { message: `${String(propertyKey)} must be at most ${max} bytes`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      },
    });
  };
}

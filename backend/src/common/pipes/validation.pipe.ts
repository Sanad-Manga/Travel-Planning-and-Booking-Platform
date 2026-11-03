import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDetailDto } from '../filters/error-response.dto';

/** Flatten nested class-validator errors into `[{ field: 'passengers.0.name', message: '...' }]`. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): ErrorDetailDto[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/** The global ValidationPipe from docs/contracts.md section 3, reporting errors in the contract shape. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ message: 'Validation failed', details: flattenValidationErrors(errors) }),
  });
}

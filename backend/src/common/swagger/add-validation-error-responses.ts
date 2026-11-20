import { OpenAPIObject } from '@nestjs/swagger';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** What a field-level 400 looks like (docs/contracts.md section 3). Shown as the example in Swagger. */
export const VALIDATION_ERROR_EXAMPLE = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'Validation failed',
  details: [
    { field: 'email', message: 'email must be valid' },
    {
      field: 'password',
      message: 'password must be at least 8 characters',
    },
  ],
  path: '/api/auth/register',
  timestamp: '2026-11-13T10:00:00.000Z',
};

/**
 * GEN-02: every endpoint that takes input (a body, query or path parameters) can answer 400 with one message per
 * broken field. Controllers that already document their own 400 keep it; any other operation gets this default,
 * so the frontend (and Swagger readers) see the same field-level error shape everywhere.
 * Mutates and returns the document.
 */
export function addValidationErrorResponses(
  document: OpenAPIObject,
): OpenAPIObject {
  const hasErrorSchema = !!document.components?.schemas?.ErrorResponseDto;
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const takesInput =
        !!operation.requestBody || (operation.parameters ?? []).length > 0;
      if (!takesInput || operation.responses?.['400']) continue;
      operation.responses = {
        ...operation.responses,
        '400': {
          description:
            'Validation failed. `details` has one entry per broken field: { field, message }.',
          content: {
            'application/json': {
              schema: hasErrorSchema
                ? { $ref: '#/components/schemas/ErrorResponseDto' }
                : { type: 'object' },
              example: VALIDATION_ERROR_EXAMPLE,
            },
          },
        },
      };
    }
  }
  return document;
}

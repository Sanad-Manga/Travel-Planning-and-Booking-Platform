import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/** Swagger helper: `@ApiPaginatedResponse(FlightResponseDto)` documents `{ items, page, limit, total, totalPages }`. */
export const ApiPaginatedResponse = <T extends Type<unknown>>(itemDto: T) =>
  applyDecorators(
    ApiExtraModels(itemDto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'page', 'limit', 'total', 'totalPages'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(itemDto) } },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          total: { type: 'integer', example: 0 },
          totalPages: { type: 'integer', example: 0 },
        },
      },
    }),
  );

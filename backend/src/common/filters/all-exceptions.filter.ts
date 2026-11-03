import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { Request, Response } from 'express';
import { ErrorDetailDto, ErrorResponseDto } from './error-response.dto';

interface MongoDuplicateKeyError {
  code: 11000;
  keyPattern?: Record<string, unknown>;
}

/**
 * The one global exception filter. Every error leaves the API as:
 * { statusCode, error, message, details?, path, timestamp }  (docs/contracts.md section 3)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, message, details } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseDto = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(details ? { details } : {}),
      path: request.originalUrl.split('?')[0],
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private normalize(exception: unknown): { statusCode: number; message: string; details?: ErrorDetailDto[] } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') return { statusCode, message: res };
      const { message, details } = res as { message?: string | string[]; details?: ErrorDetailDto[] };
      return {
        statusCode,
        message: Array.isArray(message) ? message.join('; ') : (message ?? exception.message),
        details,
      };
    }

    const err = exception as { name?: string; code?: unknown; status?: unknown; message?: string };

    // Mongo unique index violation -> 409
    if (err?.code === 11000) {
      const fields = Object.keys((exception as MongoDuplicateKeyError).keyPattern ?? {});
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Duplicate value',
        details: fields.map((field) => ({ field, message: `${field} already exists` })),
      };
    }

    // Mongoose: bad ObjectId in a query, or a schema validation failure -> 400
    if (err?.name === 'CastError') return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid identifier or value' };
    if (err?.name === 'ValidationError') return { statusCode: HttpStatus.BAD_REQUEST, message: 'Validation failed' };

    // Errors raised by Express middleware (malformed JSON, payload too large, ...) carry a 4xx status
    if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      return { statusCode: err.status, message: err.message ?? 'Bad request' };
    }

    // Anything else is a bug: never leak internals
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}

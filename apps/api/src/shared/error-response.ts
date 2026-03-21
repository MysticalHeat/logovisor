import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';

export class ErrorDetailsDto {
  code: string;
  statusCode: number;
  message: string | string[];
  path: string;
  timestamp: string;
}

export class ErrorResponseDto {
  error: ErrorDetailsDto;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request = context.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorBody =
      exception instanceof HttpException ? exception.getResponse() : null;
    const payload = normalizeErrorPayload(status, errorBody);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl ?? request.url}`,
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception),
      );
    }

    response.status(status).json({
      error: {
        ...payload,
        statusCode: status,
        path: request.originalUrl ?? request.url,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

export function ApiStandardErrorResponses(...statuses: number[]) {
  const decorators = [];

  if (statuses.includes(HttpStatus.BAD_REQUEST)) {
    decorators.push(ApiBadRequestResponse({ type: ErrorResponseDto }));
  }
  if (statuses.includes(HttpStatus.UNAUTHORIZED)) {
    decorators.push(ApiUnauthorizedResponse({ type: ErrorResponseDto }));
  }
  if (statuses.includes(HttpStatus.NOT_FOUND)) {
    decorators.push(ApiNotFoundResponse({ type: ErrorResponseDto }));
  }
  if (statuses.includes(HttpStatus.INTERNAL_SERVER_ERROR)) {
    decorators.push(ApiInternalServerErrorResponse({ type: ErrorResponseDto }));
  }

  return applyDecorators(...decorators);
}

function normalizeErrorPayload(
  status: number,
  response: unknown,
): { code: string; message: string | string[] } {
  if (typeof response === 'string') {
    return { code: statusToCode(status), message: response };
  }

  if (isRecord(response)) {
    const message = response.message;
    if (typeof message === 'string' || Array.isArray(message)) {
      return {
        code:
          typeof response.error === 'string'
            ? normalizeCode(response.error)
            : statusToCode(status),
        message,
      };
    }
  }

  return { code: statusToCode(status), message: 'internal server error' };
}

function statusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'bad_request';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    default:
      return 'internal_error';
  }
}

function normalizeCode(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

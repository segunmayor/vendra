import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError, ApplicationErrorKind, ConcurrencyConflict, DomainError } from '../../shared-kernel';

const STATUS_BY_KIND: Record<ApplicationErrorKind, number> = {
  unauthenticated: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Renders every error as RFC 9457. Unexpected errors never leak details to clients. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let detail = 'An unexpected error occurred';

    if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      detail = exception.message;
    } else if (exception instanceof ApplicationError) {
      status = STATUS_BY_KIND[exception.kind];
      code = exception.code;
      detail = exception.message;
    } else if (exception instanceof ConcurrencyConflict) {
      status = HttpStatus.CONFLICT;
      code = 'concurrency_conflict';
      detail = 'This record was changed by another request. Please retry.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `http_${status}`;
      detail = exception.message;
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title: HttpStatus[status] ?? 'Error', status, code, detail, instance: request.url });
  }
}

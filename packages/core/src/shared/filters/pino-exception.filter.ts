import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class PinoExceptionFilter implements ExceptionFilter {
  private readonly logger;
  private readonly logClientErrors: boolean;

  // logClientErrors: when true (server default) 4xx are logged as `warn`; webhook passes false
  // because as a public ingress its 400/401 are routine noise, not signal.
  constructor(serviceName = 'api', logClientErrors = true) {
    this.logger = createLogger('exception.filter', { service: serviceName });
    this.logClientErrors = logClientErrors;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: unknown }>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody = this.toResponseBody(exception, status);
    const payload = {
      status,
      requestId: request.id,
      req: { method: request.method, url: request.originalUrl ?? request.url },
      errorClass: exception instanceof Error ? exception.constructor.name : typeof exception,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ ...payload, err: exception }, 'http_exception_thrown');
    } else if (this.logClientErrors && status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn({ ...payload, response: responseBody }, 'http_client_error');
    }

    response.status(status).json(responseBody);
  }

  private toResponseBody(exception: unknown, status: number): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { statusCode: status, message: body };
      }
      return body as Record<string, unknown>;
    }
    return { statusCode: status, message: 'Internal server error' };
  }
}

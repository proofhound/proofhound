import { BadRequestException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { PinoExceptionFilter } from '../pino-exception.filter';

type LoggerStub = {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeHost(): {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  request: { id: string; method: string; originalUrl: string; url: string };
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const request = { id: 'req-1', method: 'POST', originalUrl: '/experiments', url: '/' };
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, request };
}

function makeFilter(): { filter: PinoExceptionFilter; logger: LoggerStub } {
  const filter = new PinoExceptionFilter();
  const logger: LoggerStub = { warn: vi.fn(), error: vi.fn() };
  // @ts-expect-error: override the private logger field for test assertion
  filter.logger = logger;
  return { filter, logger };
}

describe('PinoExceptionFilter', () => {
  it('4xx 客户端错误打 warn 级 http_client_error 日志，且日志含 exception body（ZodError issues）', () => {
    const { filter, logger } = makeFilter();
    const { host, status, json } = makeHost();
    const issues = [{ code: 'invalid_type', path: ['runConfig', 'concurrency'], message: 'Expected positive number' }];
    const exception = new BadRequestException(issues);

    filter.catch(exception, host);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    const [payload, msg] = logger.warn.mock.calls[0]!;
    expect(msg).toBe('http_client_error');
    expect(payload.status).toBe(HttpStatus.BAD_REQUEST);
    expect(payload.errorClass).toBe('BadRequestException');
    expect(payload.req.method).toBe('POST');
    expect(payload.req.url).toBe('/experiments');
    expect(payload.requestId).toBe('req-1');
    expect(payload.response).toMatchObject({ message: issues });
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('5xx 服务端错误打 error 级 http_exception_thrown 日志，带 err 对象', () => {
    const { filter, logger } = makeFilter();
    const { host, status } = makeHost();
    const exception = new InternalServerErrorException('boom');

    filter.catch(exception, host);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    const [payload, msg] = logger.error.mock.calls[0]!;
    expect(msg).toBe('http_exception_thrown');
    expect(payload.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.err).toBe(exception);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('非 HttpException 默认按 500 处理并打 error 日志', () => {
    const { filter, logger } = makeFilter();
    const { host, status } = makeHost();
    const exception = new TypeError('unexpected');

    filter.catch(exception, host);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0]!;
    expect(payload.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.errorClass).toBe('TypeError');
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

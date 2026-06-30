import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { PayloadTooLargeException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { QuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';
import { DatasetUploadLimitInterceptor } from '../dataset-upload-limit.interceptor';

function makeContext(projectContext: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ projectContext }) }),
  } as unknown as ExecutionContext;
}

const NEXT = { handle: () => of('handled') } as unknown as CallHandler;
const PROJECT = { projectId: 'p1', source: 'local' as const };

function makeInterceptor(opts: {
  maxBytes: number | null;
  delegate: (context: ExecutionContext, next: CallHandler) => Promise<unknown>;
}) {
  const resolveStorageQuotaBytes = vi.fn(async () => opts.maxBytes);
  const quotaPolicy = { resolveStorageQuotaBytes } as unknown as QuotaPolicyHook;
  const fileInterceptor = { intercept: vi.fn(opts.delegate) };
  const moduleRef = { create: vi.fn(async () => fileInterceptor) } as unknown as ModuleRef;
  return {
    interceptor: new DatasetUploadLimitInterceptor(quotaPolicy, moduleRef),
    resolveStorageQuotaBytes,
    fileInterceptor,
  };
}

describe('DatasetUploadLimitInterceptor', () => {
  it('resolves the dataset_upload ceiling for the request project and delegates the upload', async () => {
    const { interceptor, resolveStorageQuotaBytes, fileInterceptor } = makeInterceptor({
      maxBytes: 200 * 1024 * 1024,
      delegate: async () => of('handled'),
    });

    const result = await interceptor.intercept(makeContext(PROJECT), NEXT);

    expect(resolveStorageQuotaBytes).toHaveBeenCalledWith({ project: PROJECT, source: 'dataset_upload' });
    expect(fileInterceptor.intercept).toHaveBeenCalledTimes(1);
    await expect(result.toPromise()).resolves.toBe('handled');
  });

  it('maps a Multer LIMIT_FILE_SIZE abort to 413 with the resolved cap', async () => {
    const { interceptor } = makeInterceptor({
      maxBytes: 200 * 1024 * 1024,
      delegate: async () => {
        throw Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
      },
    });

    await expect(interceptor.intercept(makeContext(PROJECT), NEXT)).rejects.toMatchObject({
      response: { error: 'dataset_upload_too_large', maxBytes: 200 * 1024 * 1024 },
    });
    await expect(interceptor.intercept(makeContext(PROJECT), NEXT)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('rethrows non-size upload errors unchanged', async () => {
    const boom = new Error('disk full');
    const { interceptor } = makeInterceptor({ maxBytes: null, delegate: async () => Promise.reject(boom) });

    await expect(interceptor.intercept(makeContext(PROJECT), NEXT)).rejects.toBe(boom);
  });
});

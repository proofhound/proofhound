// DatasetUploadLimitInterceptor — plan-aware multipart upload gate for POST /datasets/upload.
//
// FileInterceptor's `limits.fileSize` is fixed at decorator time, so a static cap cannot reflect the
// caller's plan. This interceptor runs AFTER HttpActorGuard (which attaches `request.projectContext`),
// resolves the per-request byte ceiling via QuotaPolicyHook.resolveStorageQuotaBytes, then builds and
// delegates to a FileInterceptor configured with that ceiling — so the file stream is aborted at the
// plan limit instead of a one-size-fits-all default. A LIMIT_FILE_SIZE abort maps to 413 with the cap,
// matching the service-layer guard.
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'node:os';
import { type Observable } from 'rxjs';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';

@Injectable()
export class DatasetUploadLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly quotaPolicy: QuotaPolicyHook,
    private readonly moduleRef: ModuleRef,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ projectContext?: ProjectContext }>();
    const project = request.projectContext ?? LOCAL_PROJECT_CONTEXT;

    const maxBytes = await this.quotaPolicy.resolveStorageQuotaBytes({ project, source: 'dataset_upload' });
    const limits = typeof maxBytes === 'number' && maxBytes > 0 ? { fileSize: maxBytes } : undefined;

    const FileInterceptorClass = FileInterceptor('file', { dest: tmpdir(), limits });
    const fileInterceptor = await this.moduleRef.create(FileInterceptorClass);

    try {
      return await fileInterceptor.intercept(context, next);
    } catch (error) {
      if (isFileTooLargeError(error)) {
        throw new PayloadTooLargeException({ error: 'dataset_upload_too_large', maxBytes });
      }
      throw error;
    }
  }
}

function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'LIMIT_FILE_SIZE'
  );
}

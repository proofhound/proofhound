import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorContextResolver } from '../../../common/contracts/actor-context.resolver';
import { HttpActorGuard } from '../../../common/contracts/http-actor.guard';
import { ProjectContextResolver } from '../../../common/contracts/project-context.resolver';
import { DatasetImportController } from '../dataset-import.controller';
import { DatasetImportService } from '../dataset-import.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const IMPORT_ID = '22222222-2222-4222-8222-222222222222';

const rawImportBody = {
  name: 'Large CSV',
  description: null,
  fieldMappings: [
    { name: 'sample_id', role: 'id' },
    { name: 'text', role: 'text' },
    { name: 'expected_output', role: 'expected' },
  ],
  sourceFile: {
    fileName: 'large.csv',
    fileSizeBytes: 12 * 1024 * 1024,
    contentType: 'text/csv',
  },
  sourceFormat: 'csv',
};

function importItem(overrides: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    projectId: LOCAL_PROJECT_CONTEXT.projectId,
    datasetId: null,
    importMode: 'raw_object',
    name: rawImportBody.name,
    description: null,
    fileName: rawImportBody.sourceFile.fileName,
    fileSizeBytes: rawImportBody.sourceFile.fileSizeBytes,
    sourceFormat: rawImportBody.sourceFormat,
    declaredTotalRows: null,
    receivedRows: 0,
    status: 'uploaded',
    state: 'uploaded',
    progress: {
      state: 'uploaded',
      phase: 'uploaded',
      uploadedBytes: rawImportBody.sourceFile.fileSizeBytes,
      parsedRows: 0,
      importedRows: 0,
      totalRows: null,
      totalBytes: rawImportBody.sourceFile.fileSizeBytes,
      totalShards: null,
      completedShards: null,
      committedRows: 0,
      percentage: 75,
    },
    errorCode: null,
    errorMessage: null,
    jobId: null,
    rawUploadCompletedAt: null,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    abortedAt: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

function createServiceMock() {
  return {
    createImport: vi.fn().mockResolvedValue(importItem({ importMode: 'batch' })),
    getRawImportCapabilities: vi.fn().mockResolvedValue({ supported: true, maxBytes: 2_147_483_648 }),
    createRawImport: vi.fn().mockResolvedValue({
      import: importItem(),
      uploadSession: {
        sessionId: 'upload-1',
        url: 'https://storage.example.test/upload-1',
        headers: { 'content-type': 'text/csv' },
        expiresAt: '2026-06-20T01:00:00.000Z',
      },
      maxBytes: 2_147_483_648,
    }),
    getImport: vi.fn().mockResolvedValue(importItem()),
    appendBatch: vi.fn().mockResolvedValue({ importId: IMPORT_ID, receivedRows: 1 }),
    completeRawUpload: vi.fn().mockResolvedValue(importItem()),
    complete: vi.fn().mockResolvedValue(importItem({ status: 'queued', state: 'queued' })),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

describe('DatasetImportController', () => {
  let app: INestApplication;
  let service: ReturnType<typeof createServiceMock>;
  const resolveFromHttp = vi.fn();
  const resolveProject = vi.fn();

  beforeEach(async () => {
    service = createServiceMock();
    resolveFromHttp.mockResolvedValue({ actorId: ACTOR_ID, actorKind: 'local_user' });
    resolveProject.mockResolvedValue(LOCAL_PROJECT_CONTEXT);

    const moduleRef = await Test.createTestingModule({
      controllers: [DatasetImportController],
      providers: [
        HttpActorGuard,
        { provide: DatasetImportService, useValue: service },
        { provide: ActorContextResolver, useValue: { resolveFromHttp, resolveFromUserToken: vi.fn() } },
        { provide: ProjectContextResolver, useValue: { resolve: resolveProject } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('routes raw capabilities before the :importId path and scopes through the guard', async () => {
    await request(app.getHttpServer())
      .get('/dataset-imports/raw/capabilities')
      .expect(200, { supported: true, maxBytes: 2_147_483_648 });

    expect(resolveFromHttp).toHaveBeenCalledTimes(1);
    expect(resolveProject).toHaveBeenCalledTimes(1);
    expect(service.getRawImportCapabilities).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
    expect(service.getImport).not.toHaveBeenCalled();
  });

  it('validates and delegates raw upload session creation', async () => {
    await request(app.getHttpServer())
      .post('/dataset-imports/raw')
      .send(rawImportBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.import.importMode).toBe('raw_object');
        expect(body.uploadSession.url).toBe('https://storage.example.test/upload-1');
      });

    expect(service.createRawImport).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      rawImportBody,
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
  });

  it('rejects invalid raw import DTOs before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/dataset-imports/raw')
      .send({ ...rawImportBody, fieldMappings: [] })
      .expect(400);

    expect(service.createRawImport).not.toHaveBeenCalled();
  });

  it('keeps raw object sessions out of the batch append path at the service boundary', async () => {
    await request(app.getHttpServer())
      .post(`/dataset-imports/${IMPORT_ID}/batch`)
      .send({ batchStartIndex: 0, samples: [{ sample_id: 'case-1' }] })
      .expect(201, { importId: IMPORT_ID, receivedRows: 1 });

    expect(service.appendBatch).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      IMPORT_ID,
      { batchStartIndex: 0, samples: [{ sample_id: 'case-1' }] },
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
  });

  it('delegates raw upload completion before queueing the import job', async () => {
    await request(app.getHttpServer()).post(`/dataset-imports/${IMPORT_ID}/upload-complete`).expect(201);

    expect(service.completeRawUpload).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      IMPORT_ID,
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
    expect(service.complete).not.toHaveBeenCalled();
  });
});

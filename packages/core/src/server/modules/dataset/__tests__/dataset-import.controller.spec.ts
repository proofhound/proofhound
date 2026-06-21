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

const importBody = {
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
    name: importBody.name,
    description: null,
    fileName: importBody.sourceFile.fileName,
    fileSizeBytes: importBody.sourceFile.fileSizeBytes,
    sourceFormat: importBody.sourceFormat,
    declaredTotalRows: null,
    receivedRows: 0,
    status: 'uploading',
    state: 'uploading',
    progress: {
      state: 'uploading',
      parsedRows: 0,
      importedRows: 0,
      totalRows: null,
      totalBytes: importBody.sourceFile.fileSizeBytes,
      percentage: null,
    },
    errorCode: null,
    errorMessage: null,
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
    createImport: vi.fn().mockResolvedValue(importItem()),
    getImport: vi.fn().mockResolvedValue(importItem()),
    appendBatch: vi.fn().mockResolvedValue({ importId: IMPORT_ID, receivedRows: 1 }),
    complete: vi.fn().mockResolvedValue(importItem({ status: 'completed', state: 'completed', receivedRows: 1 })),
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

  it('validates and delegates import session creation', async () => {
    await request(app.getHttpServer())
      .post('/dataset-imports')
      .send(importBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe(IMPORT_ID);
        expect(body.status).toBe('uploading');
      });

    expect(service.createImport).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      importBody,
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
  });

  it('rejects invalid import DTOs before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/dataset-imports')
      .send({ ...importBody, fieldMappings: [] })
      .expect(400);

    expect(service.createImport).not.toHaveBeenCalled();
  });

  it('delegates batch append through the service boundary', async () => {
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

  it('delegates complete through the service boundary', async () => {
    await request(app.getHttpServer()).post(`/dataset-imports/${IMPORT_ID}/complete`).expect(201);

    expect(service.complete).toHaveBeenCalledWith(
      LOCAL_PROJECT_CONTEXT.projectId,
      IMPORT_ID,
      expect.objectContaining({ sub: ACTOR_ID, actorKind: 'local_user' }),
    );
  });
});

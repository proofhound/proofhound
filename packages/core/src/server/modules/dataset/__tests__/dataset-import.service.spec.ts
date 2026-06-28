import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, type Mocked } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import {
  DatasetImportEmptyError,
  DatasetNameTakenError,
  type DatasetImportRepository,
  type DatasetImportRow,
} from '../dataset-import.repository';
import { DatasetImportService } from '../dataset-import.service';
import type { DatasetService } from '../dataset.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import type { ObjectStorageProvider } from '../../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../../common/contracts/object-storage.provider';
import { LocalQuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';

const ACTOR: CurrentUserPayload = {
  sub: '00000000-0000-4000-8000-000000000010',
  email: 'local@example.test',
  isSuperAdmin: false,
  isActive: true,
};
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const IMPORT_ID = '00000000-0000-4000-8000-000000000100';

function fakeImport(overrides: Partial<DatasetImportRow> = {}): DatasetImportRow {
  return {
    id: IMPORT_ID,
    projectId: PROJECT_ID,
    datasetId: null,
    name: 'Large dataset',
    description: null,
    fieldMappings: [{ name: 'id', role: 'id' }],
    fileName: 'train.jsonl',
    fileSizeBytes: 1_073_741_824,
    contentType: 'application/x-ndjson',
    sourceFormat: 'jsonl',
    importMode: 'batch',
    rawUploadSessionId: null,
    rawUploadExpiresAt: null,
    rawUploadCompletedAt: null,
    rawObjectRef: null,
    progress: { phase: overrides.status ?? 'uploading' },
    declaredTotalRows: null,
    receivedRows: 0,
    jobId: null,
    errorCode: null,
    errorMessage: null,
    status: 'uploading',
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    abortedAt: null,
    createdBy: ACTOR.sub,
    createdAt: new Date('2026-05-28T00:00:00Z'),
    updatedAt: new Date('2026-05-28T00:00:00Z'),
    ...overrides,
  };
}

function fakeStorage(overrides: Partial<ObjectStorageProvider> = {}): ObjectStorageProvider {
  return {
    isEnabled: vi.fn().mockReturnValue(false),
    supportsClientUploadSessions: vi.fn().mockReturnValue(false),
    putObject: vi.fn(),
    getObject: vi.fn(),
    getObjectStream: vi.fn(),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
    createSignedDownloadUrl: vi.fn(),
    createUploadSession: vi.fn().mockResolvedValue(null),
    completeUpload: vi.fn(),
    abortUpload: vi.fn().mockResolvedValue(undefined),
    sweepPendingUploads: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as ObjectStorageProvider;
}

function buildService(storage = fakeStorage()) {
  const repo = {
    findProjectAccess: vi.fn().mockResolvedValue({ id: PROJECT_ID }),
    isDatasetNameTaken: vi.fn().mockResolvedValue(false),
    createImport: vi.fn(),
    findImportById: vi.fn(),
    appendBatch: vi.fn(),
    getSampleDataForInference: vi.fn(),
    markPromoting: vi.fn().mockResolvedValue(fakeImport({ progress: { phase: 'finalizing' } })),
    promote: vi.fn(),
    deleteImport: vi.fn().mockResolvedValue(1),
    findStaleImportIds: vi.fn(),
    findStaleImports: vi.fn(),
    deleteImportsByIds: vi.fn(),
    markRawObjectRef: vi.fn(),
    markRawUploadCompleted: vi.fn(),
    markQueued: vi.fn(),
    markParsing: vi.fn(),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markAborted: vi.fn(),
    clearStaging: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<DatasetImportRepository>;

  const datasetService = {
    getDataset: vi.fn(),
    recordDatasetImportCompleted: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<DatasetService>;

  const bullmq = { enqueueDatasetRawImportJob: vi.fn().mockResolvedValue(undefined) };
  const service = new DatasetImportService(
    repo,
    datasetService,
    new LocalAccessControlService(),
    new LocalQuotaPolicyHook(),
    storage,
    bullmq as never,
  );
  return { service, repo, datasetService, storage: storage as Mocked<ObjectStorageProvider>, bullmq };
}

const CREATE_DTO = {
  name: 'Large dataset',
  fieldMappings: [{ name: 'id', role: 'id' as const }],
  sourceFile: { fileName: 'train.jsonl', fileSizeBytes: 1_073_741_824 },
  sourceFormat: 'jsonl' as const,
};

describe('DatasetImportService.createImport', () => {
  it('rejects a name that already belongs to an existing dataset', async () => {
    const { service, repo } = buildService();
    repo.isDatasetNameTaken.mockResolvedValue(true);

    await expect(service.createImport(PROJECT_ID, CREATE_DTO, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createImport).not.toHaveBeenCalled();
  });

  it('creates an uploading session', async () => {
    const { service, repo } = buildService();
    repo.createImport.mockResolvedValue(fakeImport());

    const result = await service.createImport(PROJECT_ID, CREATE_DTO, ACTOR);

    expect(result.id).toBe(IMPORT_ID);
    expect(result.status).toBe('uploading');
    expect(repo.createImport).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      actorUserId: ACTOR.sub,
      dto: CREATE_DTO,
      initialStatus: 'uploading',
    });
  });
});

describe('DatasetImportService raw import', () => {
  const RAW_REF: StoredObjectRef = {
    provider: 'fake',
    key: 'dataset_raw/imp/input.csv',
    bytes: 128,
    resourceType: 'dataset_raw',
    resourceId: IMPORT_ID,
  };

  it('reports raw import unavailable when the provider cannot create browser upload sessions', async () => {
    const { service, storage } = buildService(fakeStorage({ isEnabled: vi.fn().mockReturnValue(true) }));

    await expect(service.getRawImportCapabilities(PROJECT_ID, ACTOR)).resolves.toEqual({
      supported: false,
      maxBytes: 2_147_483_648,
    });
    await expect(service.createRawImport(PROJECT_ID, CREATE_DTO, ACTOR)).rejects.toThrow(
      'dataset_raw_upload_unavailable',
    );
    expect(storage.createUploadSession).not.toHaveBeenCalled();
  });

  it('creates a raw import session with provider upload metadata', async () => {
    const storage = fakeStorage({
      isEnabled: vi.fn().mockReturnValue(true),
      supportsClientUploadSessions: vi.fn().mockReturnValue(true),
      createUploadSession: vi.fn().mockResolvedValue({
        sessionId: 'upload-1',
        url: 'https://storage.example/upload',
        expiresAt: '2026-06-20T00:00:00.000Z',
      }),
    });
    const { service, repo } = buildService(storage);
    repo.createImport.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        rawUploadSessionId: 'upload-1',
        rawUploadExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
        sourceFormat: 'csv',
      }),
    );

    const result = await service.createRawImport(
      PROJECT_ID,
      { ...CREATE_DTO, sourceFile: { fileName: 'train.csv', fileSizeBytes: 128 }, sourceFormat: 'csv' },
      ACTOR,
    );

    expect(result.import.importMode).toBe('raw_object');
    expect(result.uploadSession.sessionId).toBe('upload-1');
    expect(storage.createUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'dataset_raw', name: 'input.csv' }),
      expect.objectContaining({ maxBytes: 128 }),
    );
    expect(repo.createImport).toHaveBeenCalledWith(
      expect.objectContaining({
        importMode: 'raw_object',
        rawUploadSession: { sessionId: 'upload-1', expiresAt: '2026-06-20T00:00:00.000Z' },
      }),
    );
  });

  it('finalizes a raw upload and moves the session to uploaded', async () => {
    const storage = fakeStorage({
      isEnabled: vi.fn().mockReturnValue(true),
      supportsClientUploadSessions: vi.fn().mockReturnValue(true),
      completeUpload: vi.fn().mockResolvedValue(RAW_REF),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    });
    const { service, repo } = buildService(storage);
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        sourceFormat: 'csv',
        rawUploadSessionId: 'upload-1',
      }),
    );
    repo.markRawUploadCompleted.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        status: 'uploaded',
        rawUploadSessionId: 'upload-1',
        rawObjectRef: RAW_REF,
      }),
    );

    const result = await service.completeRawUpload(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(storage.completeUpload).toHaveBeenCalledWith({
      sessionId: 'upload-1',
      actor: expect.objectContaining({ actorId: ACTOR.sub, actorKind: 'local_user' }),
      project: { projectId: PROJECT_ID, source: 'local' },
    });
    expect(repo.markRawUploadCompleted).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, RAW_REF);
    expect(result.status).toBe('uploaded');
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('queues a raw import job after upload completion', async () => {
    const { service, repo, bullmq } = buildService();
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        status: 'uploaded',
        sourceFormat: 'csv',
        rawUploadSessionId: 'upload-1',
        rawObjectRef: RAW_REF,
      }),
    );
    repo.markQueued.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        status: 'queued',
        jobId: `dataset-raw-import-${IMPORT_ID}`,
        rawUploadSessionId: 'upload-1',
        rawObjectRef: RAW_REF,
      }),
    );

    const result = await service.complete(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(repo.markQueued).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, `dataset-raw-import-${IMPORT_ID}`);
    expect(bullmq.enqueueDatasetRawImportJob).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR.sub },
      `dataset-raw-import-${IMPORT_ID}`,
    );
    expect(result.status).toBe('queued');
  });

  it('returns the current raw import status once the job has been queued', async () => {
    const { service, repo, bullmq } = buildService();
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        status: 'queued',
        jobId: `dataset-raw-import-${IMPORT_ID}`,
        rawObjectRef: RAW_REF,
      }),
    );

    const result = await service.complete(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(result.status).toBe('queued');
    expect(repo.markQueued).not.toHaveBeenCalled();
    expect(bullmq.enqueueDatasetRawImportJob).not.toHaveBeenCalled();
  });

  it('marks the session failed when queue enqueue fails', async () => {
    const { service, repo, bullmq } = buildService();
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        status: 'uploaded',
        rawObjectRef: RAW_REF,
      }),
    );
    repo.markQueued.mockResolvedValue(
      fakeImport({ importMode: 'raw_object', status: 'queued', rawObjectRef: RAW_REF }),
    );
    bullmq.enqueueDatasetRawImportJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.complete(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toThrow('redis down');

    expect(repo.markFailed).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, 'dataset_import_enqueue_failed', 'redis down');
  });

  it('aborts the pending raw upload session when completeUpload fails', async () => {
    const storage = fakeStorage({
      isEnabled: vi.fn().mockReturnValue(true),
      supportsClientUploadSessions: vi.fn().mockReturnValue(true),
      completeUpload: vi.fn().mockRejectedValue(new Error('upload_missing')),
      abortUpload: vi.fn().mockResolvedValue(undefined),
    });
    const { service, repo } = buildService(storage);
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        sourceFormat: 'csv',
        rawUploadSessionId: 'upload-1',
      }),
    );

    await expect(service.completeRawUpload(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toThrow('upload_missing');

    expect(repo.markFailed).toHaveBeenCalledWith(
      PROJECT_ID,
      IMPORT_ID,
      'dataset_raw_upload_complete_failed',
      'upload_missing',
    );
    expect(storage.abortUpload).toHaveBeenCalledWith('upload-1');
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('cleans the finalized raw object when uploaded bytes exceed the raw limit', async () => {
    const storage = fakeStorage({
      isEnabled: vi.fn().mockReturnValue(true),
      supportsClientUploadSessions: vi.fn().mockReturnValue(true),
      completeUpload: vi.fn().mockResolvedValue({ ...RAW_REF, bytes: 3 * 1024 * 1024 * 1024 }),
      abortUpload: vi.fn().mockResolvedValue(undefined),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    });
    const { service, repo } = buildService(storage);
    repo.findImportById.mockResolvedValue(
      fakeImport({
        importMode: 'raw_object',
        sourceFormat: 'csv',
        rawUploadSessionId: 'upload-1',
      }),
    );

    await expect(service.completeRawUpload(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.markFailed).toHaveBeenCalledWith(
      PROJECT_ID,
      IMPORT_ID,
      'dataset_raw_upload_complete_failed',
      'dataset_raw_upload_too_large',
    );
    expect(storage.abortUpload).toHaveBeenCalledWith('upload-1');
    expect(storage.deleteObjects).toHaveBeenCalledWith([{ ...RAW_REF, bytes: 3 * 1024 * 1024 * 1024 }]);
  });
});

describe('DatasetImportService.appendBatch', () => {
  it('rejects a batch that leaves a gap in the contiguous prefix', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport({ receivedRows: 0 }));

    await expect(
      service.appendBatch(PROJECT_ID, IMPORT_ID, { batchStartIndex: 5, samples: [{ id: 'a' }] }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.appendBatch).not.toHaveBeenCalled();
  });

  it('assigns row indexes + external ids and advances received rows', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport({ receivedRows: 0 }));
    repo.appendBatch.mockResolvedValue(2);

    const result = await service.appendBatch(
      PROJECT_ID,
      IMPORT_ID,
      { batchStartIndex: 0, samples: [{ id: 'a' }, { id: 'b' }] },
      ACTOR,
    );

    expect(result).toEqual({ importId: IMPORT_ID, receivedRows: 2 });
    expect(repo.appendBatch).toHaveBeenCalledWith(
      IMPORT_ID,
      [
        { rowIndex: 0, data: { id: 'a' }, externalId: 'a' },
        { rowIndex: 1, data: { id: 'b' }, externalId: 'b' },
      ],
      2,
    );
  });

  it('rejects appending to a non-importing session', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport({ status: 'completed' }));

    await expect(
      service.appendBatch(PROJECT_ID, IMPORT_ID, { batchStartIndex: 0, samples: [{ id: 'a' }] }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DatasetImportService.complete', () => {
  it('maps an empty staging set to a bad request', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport());
    repo.getSampleDataForInference.mockResolvedValue([]);
    repo.promote.mockRejectedValue(new DatasetImportEmptyError());

    await expect(service.complete(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a taken name to a conflict', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport());
    repo.getSampleDataForInference.mockResolvedValue([{ id: 'a' }]);
    repo.promote.mockRejectedValue(new DatasetNameTakenError());

    await expect(service.complete(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('promotes with a field schema derived from mappings + sampled rows', async () => {
    const { service, repo, datasetService } = buildService();
    repo.findImportById
      .mockResolvedValueOnce(
        fakeImport({ fieldMappings: [{ name: 'label', role: 'expected' }], name: 'Large dataset' }),
      )
      .mockResolvedValueOnce(
        fakeImport({
          fieldMappings: [{ name: 'label', role: 'expected' }],
          name: 'Large dataset',
          status: 'completed',
          datasetId: '00000000-0000-4000-8000-000000000200',
          receivedRows: 3,
          completedAt: new Date('2026-05-28T00:01:00Z'),
        }),
      );
    repo.markPromoting.mockResolvedValue(
      fakeImport({
        fieldMappings: [{ name: 'label', role: 'expected' }],
        name: 'Large dataset',
        progress: { phase: 'finalizing' },
      }),
    );
    repo.getSampleDataForInference.mockResolvedValue([{ label: 'spam' }]);
    repo.promote.mockResolvedValue({ sampleCount: 3 });

    const result = await service.complete(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(result.status).toBe('completed');
    expect(result.datasetId).toBe('00000000-0000-4000-8000-000000000200');
    expect(repo.markPromoting).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, {
      stalePromotionBefore: expect.any(Date),
    });
    const promoteArgs = repo.promote.mock.calls[0]?.[0];
    expect(promoteArgs?.fieldSchema).toEqual([{ name: 'label', role: 'expected_output', type: 'string' }]);
    expect(promoteArgs?.hasImages).toBe(false);
    await promoteArgs?.onProgress?.({
      phase: 'offloading',
      totalShards: 2,
      completedShards: 1,
      committedRows: 200,
    });
    expect(repo.updateProgress).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, {
      phase: 'offloading',
      totalShards: 2,
      completedShards: 1,
      committedRows: 200,
    });
    expect(datasetService.recordDatasetImportCompleted).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      datasetId: promoteArgs?.datasetId,
      importId: IMPORT_ID,
      actorId: ACTOR.sub,
      sampleCount: 3,
    });
  });
});

describe('DatasetImportService.abort', () => {
  it('marks the session aborted and cleans raw resources', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport({ rawUploadSessionId: 'upload-1' }));
    repo.markAborted.mockResolvedValue(fakeImport({ status: 'aborted', rawUploadSessionId: 'upload-1' }));

    await service.abort(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, { clearStaging: true });
  });

  it('defers staging cleanup when aborting a promote that is already finalizing', async () => {
    const rawObjectRef: StoredObjectRef = {
      provider: 'fake',
      key: 'dataset_raw/import/input.csv',
      bytes: 100,
      resourceType: 'dataset_raw',
      resourceId: IMPORT_ID,
    };
    const storage = fakeStorage({
      abortUpload: vi.fn().mockResolvedValue(undefined),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    });
    const { service, repo } = buildService(storage);
    repo.findImportById.mockResolvedValue(
      fakeImport({ progress: { phase: 'offloading' }, rawUploadSessionId: 'upload-1', rawObjectRef }),
    );
    repo.markAborted.mockResolvedValue(fakeImport({ status: 'aborted', rawUploadSessionId: 'upload-1', rawObjectRef }));

    await service.abort(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, { clearStaging: false });
    expect(repo.clearStaging).not.toHaveBeenCalled();
    expect(storage.abortUpload).toHaveBeenCalledWith('upload-1');
    expect(storage.deleteObjects).toHaveBeenCalledWith([rawObjectRef]);
  });

  it('surfaces a missing import only on get, not on abort', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(null);

    await expect(service.getImport(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DatasetImportService.sweepStaleImports', () => {
  it('marks stale pre-queued sessions aborted', async () => {
    const { service, repo } = buildService();
    repo.findStaleImports.mockResolvedValue([fakeImport({ id: 'a' }), fakeImport({ id: 'b' })]);
    repo.markAborted.mockResolvedValue(fakeImport({ status: 'aborted' }));

    await service.sweepStaleImports();

    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, 'a');
    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, 'b');
  });

  it('does nothing when there are no stale sessions', async () => {
    const { service, repo } = buildService();
    repo.findStaleImports.mockResolvedValue([]);

    await service.sweepStaleImports();

    expect(repo.markAborted).not.toHaveBeenCalled();
  });

  it('cleans pending and finalized raw objects for stale sessions', async () => {
    const storage = fakeStorage({
      abortUpload: vi.fn().mockResolvedValue(undefined),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
      sweepPendingUploads: vi.fn().mockResolvedValue(3),
    });
    const { service, repo } = buildService(storage);
    const rawObjectRef: StoredObjectRef = {
      provider: 'fake',
      key: 'dataset_raw/import/input.csv',
      bytes: 100,
      resourceType: 'dataset_raw',
      resourceId: IMPORT_ID,
    };
    repo.findStaleImports.mockResolvedValue([
      fakeImport({
        importMode: 'raw_object',
        rawUploadSessionId: 'upload-1',
        rawObjectRef,
      }),
    ]);
    repo.markAborted.mockResolvedValue(fakeImport({ status: 'aborted', rawUploadSessionId: 'upload-1', rawObjectRef }));

    await service.sweepStaleImports();

    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID);
    expect(storage.abortUpload).toHaveBeenCalledWith('upload-1');
    expect(storage.deleteObjects).toHaveBeenCalledWith([rawObjectRef]);
    expect(storage.sweepPendingUploads).toHaveBeenCalled();
  });

  it('finishes deferred cleanup for aborted promotion sessions', async () => {
    const storage = fakeStorage({
      abortUpload: vi.fn().mockResolvedValue(undefined),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
      sweepPendingUploads: vi.fn().mockResolvedValue(0),
    });
    const { service, repo } = buildService(storage);
    const rawObjectRef: StoredObjectRef = {
      provider: 'fake',
      key: 'dataset_raw/import/input.csv',
      bytes: 100,
      resourceType: 'dataset_raw',
      resourceId: IMPORT_ID,
    };
    repo.findStaleImports.mockResolvedValue([
      fakeImport({
        status: 'aborted',
        progress: { phase: 'aborted', cleanupPending: 1 },
        rawObjectRef,
      }),
    ]);

    await service.sweepStaleImports();

    expect(repo.markAborted).not.toHaveBeenCalled();
    expect(repo.clearStaging).toHaveBeenCalledWith(IMPORT_ID);
    expect(repo.updateProgress).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, { cleanupPending: null });
    expect(storage.deleteObjects).toHaveBeenCalledWith([rawObjectRef]);
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DATASET_IMPORT_MAX_FILE_BYTES, DATASET_IMPORT_ZIP_MAX_FILE_BYTES } from '@proofhound/shared';
import { describe, expect, it, vi, type Mocked } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import {
  DatasetImportEmptyError,
  DatasetNameTakenError,
  MAX_DATASET_PROMOTE_STORAGE_CONCURRENCY,
  type DatasetImportRepository,
  type DatasetImportRow,
  type PromoteDatasetImportResult,
  resolveDatasetPromoteStorageConcurrency,
} from '../dataset-import.repository';
import { DatasetImportService } from '../dataset-import.service';
import type { DatasetService } from '../dataset.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { LocalQuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';

const ACTOR: CurrentUserPayload = {
  sub: '00000000-0000-4000-8000-000000000010',
  email: 'local@example.test',
  isSuperAdmin: false,
  isActive: true,
};
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const IMPORT_ID = '00000000-0000-4000-8000-000000000100';

function promoteResult(sampleCount: number): PromoteDatasetImportResult {
  return {
    sampleCount,
    metrics: {
      preflightMs: 1,
      offloadMs: 0,
      commitMs: 1,
      datasetSamplesInsertMs: 1,
      offload: null,
    },
  };
}

describe('resolveDatasetPromoteStorageConcurrency', () => {
  it('defaults invalid values and caps very high concurrency', () => {
    expect(resolveDatasetPromoteStorageConcurrency(undefined)).toBe(4);
    expect(resolveDatasetPromoteStorageConcurrency('0')).toBe(4);
    expect(resolveDatasetPromoteStorageConcurrency('8')).toBe(8);
    expect(resolveDatasetPromoteStorageConcurrency('9999')).toBe(MAX_DATASET_PROMOTE_STORAGE_CONCURRENCY);
  });
});

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
    declaredTotalRows: null,
    receivedRows: 0,
    errorCode: null,
    errorMessage: null,
    status: 'uploading',
    completedAt: null,
    failedAt: null,
    abortedAt: null,
    createdBy: ACTOR.sub,
    createdAt: new Date('2026-05-28T00:00:00Z'),
    updatedAt: new Date('2026-05-28T00:00:00Z'),
    ...overrides,
  };
}

function buildService() {
  const repo = {
    findProjectAccess: vi.fn().mockResolvedValue({ id: PROJECT_ID }),
    isDatasetNameTaken: vi.fn().mockResolvedValue(false),
    createImport: vi.fn(),
    findImportById: vi.fn(),
    appendBatch: vi.fn(),
    getSampleDataForInference: vi.fn(),
    promote: vi.fn(),
    deleteImport: vi.fn().mockResolvedValue(1),
    findStaleImportIds: vi.fn(),
    findStaleImports: vi.fn(),
    deleteImportsByIds: vi.fn(),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markAborted: vi.fn(),
    clearStaging: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<DatasetImportRepository>;

  const datasetService = {
    getDataset: vi.fn(),
    recordDatasetImportCompleted: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<DatasetService>;

  const service = new DatasetImportService(repo, datasetService, new LocalAccessControlService(), new LocalQuotaPolicyHook());
  return { service, repo, datasetService };
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

  it('rejects source files above the import file-size limit before creating a session', async () => {
    const { service, repo } = buildService();

    await expect(
      service.createImport(
        PROJECT_ID,
        {
          ...CREATE_DTO,
          sourceFile: { fileName: 'too-large.csv', fileSizeBytes: DATASET_IMPORT_MAX_FILE_BYTES + 1 },
          sourceFormat: 'csv',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createImport).not.toHaveBeenCalled();
  });

  it('rejects ZIP source files above the ZIP parser limit before creating a session', async () => {
    const { service, repo } = buildService();

    await expect(
      service.createImport(
        PROJECT_ID,
        {
          ...CREATE_DTO,
          sourceFile: { fileName: 'too-large.zip', fileSizeBytes: DATASET_IMPORT_ZIP_MAX_FILE_BYTES + 1 },
          sourceFormat: 'zip',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createImport).not.toHaveBeenCalled();
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
    repo.getSampleDataForInference.mockResolvedValue([{ label: 'spam' }]);
    repo.promote.mockResolvedValue(promoteResult(3));

    const result = await service.complete(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(result.status).toBe('completed');
    expect(result.datasetId).toBe('00000000-0000-4000-8000-000000000200');
    const promoteArgs = repo.promote.mock.calls[0]?.[0];
    expect(promoteArgs?.fieldSchema).toEqual([{ name: 'label', role: 'expected_output', type: 'string' }]);
    expect(promoteArgs?.hasImages).toBe(false);
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
  it('marks the session aborted; repository clears staging rows', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(fakeImport());
    repo.markAborted.mockResolvedValue(fakeImport({ status: 'aborted' }));

    await service.abort(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(repo.markAborted).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID);
  });

  it('surfaces a missing import only on get, not on abort', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(null);

    await expect(service.getImport(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DatasetImportService.sweepStaleImports', () => {
  it('marks stale pre-complete sessions aborted', async () => {
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

});

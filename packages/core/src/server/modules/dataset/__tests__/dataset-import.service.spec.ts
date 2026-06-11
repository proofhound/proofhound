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
    declaredTotalRows: null,
    receivedRows: 0,
    status: 'importing',
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
    deleteImportsByIds: vi.fn(),
  } as unknown as Mocked<DatasetImportRepository>;

  const datasetService = {
    getDataset: vi.fn(),
    recordDatasetImportCompleted: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<DatasetService>;

  const service = new DatasetImportService(
    repo,
    datasetService,
    new LocalAccessControlService(),
    new LocalQuotaPolicyHook(),
  );
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

  it('creates an importing session', async () => {
    const { service, repo } = buildService();
    repo.createImport.mockResolvedValue(fakeImport());

    const result = await service.createImport(PROJECT_ID, CREATE_DTO, ACTOR);

    expect(result.id).toBe(IMPORT_ID);
    expect(result.status).toBe('importing');
    expect(repo.createImport).toHaveBeenCalledWith({ projectId: PROJECT_ID, actorUserId: ACTOR.sub, dto: CREATE_DTO });
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
    repo.findImportById.mockResolvedValue(fakeImport({ status: 'ready' }));

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
    repo.findImportById.mockResolvedValue(
      fakeImport({ fieldMappings: [{ name: 'label', role: 'expected' }], name: 'Large dataset' }),
    );
    repo.getSampleDataForInference.mockResolvedValue([{ label: 'spam' }]);
    repo.promote.mockResolvedValue({ sampleCount: 3 });
    datasetService.getDataset.mockResolvedValue({ id: 'ds-1' } as never);

    const result = await service.complete(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(result).toEqual({ dataset: { id: 'ds-1' }, sampleCount: 3 });
    const promoteArgs = repo.promote.mock.calls[0]?.[0];
    expect(promoteArgs?.fieldSchema).toEqual([{ name: 'label', role: 'expected_output', type: 'string' }]);
    expect(promoteArgs?.hasImages).toBe(false);
    expect(datasetService.getDataset).toHaveBeenCalledWith(PROJECT_ID, promoteArgs?.datasetId, ACTOR);
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
  it('deletes the session (staging cascades)', async () => {
    const { service, repo } = buildService();

    await service.abort(PROJECT_ID, IMPORT_ID, ACTOR);

    expect(repo.deleteImport).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID);
  });

  it('surfaces a missing import only on get, not on abort', async () => {
    const { service, repo } = buildService();
    repo.findImportById.mockResolvedValue(null);

    await expect(service.getImport(PROJECT_ID, IMPORT_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DatasetImportService.sweepStaleImports', () => {
  it('reaps stale importing sessions', async () => {
    const { service, repo } = buildService();
    repo.findStaleImportIds.mockResolvedValue(['a', 'b']);
    repo.deleteImportsByIds.mockResolvedValue(2);

    await service.sweepStaleImports();

    expect(repo.deleteImportsByIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('does nothing when there are no stale sessions', async () => {
    const { service, repo } = buildService();
    repo.findStaleImportIds.mockResolvedValue([]);

    await service.sweepStaleImports();

    expect(repo.deleteImportsByIds).not.toHaveBeenCalled();
  });
});

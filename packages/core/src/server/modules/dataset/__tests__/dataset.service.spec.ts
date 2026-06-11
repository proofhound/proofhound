import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatasetRepository, type DatasetProjectAccessRow, type DatasetRow } from '../dataset.repository';
import { DatasetService } from '../dataset.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { LocalQuotaPolicyHook, QuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';
import { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';
import { vi, type Mock, type Mocked } from 'vitest';

const actor = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  isSuperAdmin: false,
  isActive: true,
};

const projectAccess = (): DatasetProjectAccessRow => ({
  id: '77777777-7777-4777-8777-777777777777',
});

const datasetRow = (overrides: Partial<DatasetRow> = {}): DatasetRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '77777777-7777-4777-8777-777777777777',
  name: 'risk-eval-v4',
  description: 'new samples',
  sampleCount: 2,
  fieldSchema: [
    { name: 'sample_id', role: 'metadata', type: 'string' },
    { name: 'question', role: 'text', type: 'string' },
    { name: 'label', role: 'expected_output', type: 'string' },
  ],
  hasImages: false,
  storagePrefix: 'datasets/77777777-7777-4777-8777-777777777777/raw/22222222-2222-4222-8222-222222222222/risk.csv',
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdAt: new Date('2026-05-16T00:00:00Z'),
  updatedAt: new Date('2026-05-16T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

function makeRepo(): Mocked<DatasetRepository> {
  return {
    findProjectAccess: vi.fn(),
    findDatasetByProjectAndName: vi.fn(),
    findDatasetById: vi.fn(),
    listDatasets: vi.fn(),
    listDatasetSamples: vi.fn(),
    listDatasetSamplesPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    aggregateCategoryDistribution: vi.fn().mockResolvedValue([]),
    countDatasetReferences: vi.fn().mockResolvedValue(new Map()),
    hardDeleteSamples: vi.fn().mockResolvedValue(0),
    decrementDatasetSampleCount: vi.fn().mockResolvedValue(undefined),
    hardDeleteDataset: vi.fn(),
    updateDatasetMetadata: vi.fn(),
    createDatasetWithSamples: vi.fn(),
  } as unknown as Mocked<DatasetRepository>;
}

describe('DatasetService', () => {
  let service: DatasetService;
  let repo: Mocked<DatasetRepository>;
  let usageMetering: UsageMeteringHook & { record: Mock };

  beforeEach(async () => {
    repo = makeRepo();
    usageMetering = { record: vi.fn(async () => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DatasetRepository, useValue: repo },
        { provide: AccessControlService, useClass: LocalAccessControlService },
        { provide: QuotaPolicyHook, useClass: LocalQuotaPolicyHook },
        { provide: UsageMeteringHook, useValue: usageMetering },
        DatasetService,
      ],
    }).compile();

    service = module.get(DatasetService);
  });

  it('creates a dataset with inferred schema metadata', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetByProjectAndName.mockResolvedValue(null);
    repo.createDatasetWithSamples.mockResolvedValue(datasetRow());

    const result = await service.createDataset(
      '77777777-7777-4777-8777-777777777777',
      {
        name: 'risk-eval-v4',
        description: 'new samples',
        uploadSource: { fileName: 'risk.csv', fileSizeBytes: 128, contentType: 'text/csv' },
        fieldMappings: [
          { name: 'sample_id', role: 'id' },
          { name: 'question', role: 'text' },
          { name: 'label', role: 'expected' },
        ],
        samples: [
          { sample_id: 'case-1', question: '是否拦截?', label: 'block' },
          { sample_id: 'case-2', question: '是否放行?', label: 'allow' },
        ],
      },
      actor,
    );

    expect(repo.createDatasetWithSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '77777777-7777-4777-8777-777777777777',
        actorUserId: actor.sub,
        externalIdFieldName: 'sample_id',
        fieldSchema: [
          { name: 'sample_id', role: 'metadata', type: 'string' },
          { name: 'question', role: 'text', type: 'string' },
          { name: 'label', role: 'expected_output', type: 'string' },
        ],
        hasImages: false,
      }),
    );
    expect(result.sampleCount).toBe(2);
    expect(result.dataset.categoryDistribution).toEqual({
      field: 'label',
      total: 2,
      categories: [
        { label: 'allow', count: 1 },
        { label: 'block', count: 1 },
      ],
    });
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'storage',
        eventType: 'dataset.created',
        projectId: '77777777-7777-4777-8777-777777777777',
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'storage',
        eventType: 'storage.dirty',
        projectId: '77777777-7777-4777-8777-777777777777',
      }),
    );
  });

  it('infers image URL arrays and multiple image fields as image dataset fields', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetByProjectAndName.mockResolvedValue(null);
    repo.createDatasetWithSamples.mockResolvedValue(
      datasetRow({
        fieldSchema: [
          { name: 'sample_id', role: 'metadata', type: 'string' },
          { name: 'image_urls', role: 'image_url', type: 'array' },
          { name: 'detail_image', role: 'image_base64', type: 'string' },
          { name: 'label', role: 'expected_output', type: 'string' },
        ],
        hasImages: true,
      }),
    );

    await service.createDataset(
      '77777777-7777-4777-8777-777777777777',
      {
        name: 'multi-image-eval',
        description: null,
        uploadSource: { fileName: 'multi-image.jsonl', fileSizeBytes: 256, contentType: 'application/jsonl' },
        fieldMappings: [
          { name: 'sample_id', role: 'id' },
          { name: 'image_urls', role: 'image' },
          { name: 'detail_image', role: 'image' },
          { name: 'label', role: 'expected' },
        ],
        samples: [
          {
            sample_id: 'case-1',
            image_urls: ['https://example.test/a,b.png?x=1;2', 'https://example.test/back.png'],
            detail_image: 'data:image/png;base64,iVBORw0KGgo=',
            label: 'pass',
          },
        ],
      },
      actor,
    );

    expect(repo.createDatasetWithSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldSchema: [
          { name: 'sample_id', role: 'metadata', type: 'string' },
          { name: 'image_urls', role: 'image_url', type: 'array' },
          { name: 'detail_image', role: 'image_base64', type: 'string' },
          { name: 'label', role: 'expected_output', type: 'string' },
        ],
        hasImages: true,
      }),
    );
  });

  it('rejects duplicate field mappings before writing rows', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());

    await expect(
      service.createDataset(
        '77777777-7777-4777-8777-777777777777',
        {
          name: 'risk-eval-v4',
          description: null,
          uploadSource: { fileName: 'risk.csv', fileSizeBytes: 128 },
          fieldMappings: [
            { name: 'question', role: 'text' },
            { name: 'question', role: 'expected' },
          ],
          samples: [{ question: 'hello' }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.createDatasetWithSamples).not.toHaveBeenCalled();
  });

  it('rejects multiple expected output fields before writing rows', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());

    await expect(
      service.createDataset(
        '77777777-7777-4777-8777-777777777777',
        {
          name: 'risk-eval-v4',
          description: null,
          uploadSource: { fileName: 'risk.csv', fileSizeBytes: 128 },
          fieldMappings: [
            { name: 'label', role: 'expected' },
            { name: 'expected_json', role: 'expected' },
          ],
          samples: [{ label: 'block', expected_json: { label: 'block' } }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.createDatasetWithSamples).not.toHaveBeenCalled();
  });

  it('returns category distribution for the dataset list page', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listDatasets.mockResolvedValue([datasetRow({ sampleCount: 4 })]);
    // SQL GROUP BY already filters out non-scalar labels (e.g. object-valued) server-side.
    repo.aggregateCategoryDistribution.mockResolvedValue([
      { label: 'block', count: 2 },
      { label: 'allow', count: 1 },
    ]);

    const result = await service.listDatasets('77777777-7777-4777-8777-777777777777', actor);

    expect(repo.aggregateCategoryDistribution).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'label');
    expect(result.data[0]?.categoryDistribution).toEqual({
      field: 'label',
      total: 3,
      categories: [
        { label: 'block', count: 2 },
        { label: 'allow', count: 1 },
      ],
    });
  });

  it('returns a dataset and its persisted samples for the detail page', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.listDatasetSamplesPage.mockResolvedValue({
      rows: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          datasetId: '22222222-2222-4222-8222-222222222222',
          data: { sample_id: 'case-1', question: '是否拦截?', label: 'block' },
          externalId: 'case-1',
          createdAt: new Date('2026-05-16T00:00:00Z'),
          updatedAt: new Date('2026-05-16T00:00:00Z'),
        },
      ],
      total: 1,
    });

    const dataset = await service.getDataset(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
    );
    const samples = await service.listDatasetSamples(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
      { page: 1, pageSize: 50 },
    );

    expect(dataset.name).toBe('risk-eval-v4');
    expect(dataset.createdByDisplayName).toBe('Alice');
    expect(samples).toMatchObject({
      total: 1,
      data: [
        {
          externalId: 'case-1',
          data: { question: '是否拦截?', label: 'block' },
        },
      ],
    });
  });

  it('exports dataset samples as CSV with ordered schema fields and extra fields', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.listDatasetSamples.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        datasetId: '22222222-2222-4222-8222-222222222222',
        data: {
          sample_id: 'case-1',
          question: '是否拦截, 这次访问?',
          label: { decision: 'block' },
          source: 'manual',
        },
        externalId: 'case-1',
        createdAt: new Date('2026-05-16T00:00:00Z'),
        updatedAt: new Date('2026-05-16T00:00:00Z'),
      },
    ]);

    const file = await service.exportDataset(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'csv',
      actor,
    );

    expect(file.fileName).toBe('risk-eval-v4.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.byteLength).toBe(file.buffer.byteLength);
    expect(file.buffer.toString('utf8')).toBe(
      '\uFEFFsample_id,question,label,source\ncase-1,"是否拦截, 这次访问?","{""decision"":""block""}",manual\n',
    );
  });

  it('exports dataset samples as JSONL', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.listDatasetSamples.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        datasetId: '22222222-2222-4222-8222-222222222222',
        data: { sample_id: 'case-1', question: '是否拦截?', label: 'block' },
        externalId: 'case-1',
        createdAt: new Date('2026-05-16T00:00:00Z'),
        updatedAt: new Date('2026-05-16T00:00:00Z'),
      },
    ]);

    const file = await service.exportDataset(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'jsonl',
      actor,
    );

    expect(file.fileName).toBe('risk-eval-v4.jsonl');
    expect(file.contentType).toBe('application/x-ndjson; charset=utf-8');
    expect(file.buffer.toString('utf8')).toBe('{"sample_id":"case-1","question":"是否拦截?","label":"block"}\n');
  });

  it('hard deletes a dataset', async () => {
    vi.useFakeTimers();
    const deletedAt = new Date('2026-05-19T08:30:00.000Z');
    vi.setSystemTime(deletedAt);
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.countDatasetReferences.mockResolvedValue(
      new Map([['22222222-2222-4222-8222-222222222222', { experiments: 0, optimizations: 0 }]]),
    );
    repo.hardDeleteDataset.mockResolvedValue(1);

    try {
      await service.deleteDataset(
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222',
        actor,
      );

      expect(repo.hardDeleteDataset).toHaveBeenCalledWith(
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222',
      );
      expect(usageMetering.record).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'storage',
          eventType: 'dataset.deleted',
          occurredAt: deletedAt,
          idempotencyKey: `storage:dataset.deleted:22222222-2222-4222-8222-222222222222:${deletedAt.toISOString()}`,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects deleting a dataset referenced by experiments or optimizations', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.countDatasetReferences.mockResolvedValue(
      new Map([['22222222-2222-4222-8222-222222222222', { experiments: 1, optimizations: 0 }]]),
    );

    await expect(
      service.deleteDataset('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', actor),
    ).rejects.toThrow(ConflictException);

    expect(repo.hardDeleteDataset).not.toHaveBeenCalled();
  });

  it('updates dataset metadata', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.findDatasetByProjectAndName.mockResolvedValue(null);
    repo.updateDatasetMetadata.mockResolvedValue(
      datasetRow({
        name: 'risk-eval-renamed',
        description: 'renamed samples',
        updatedAt: new Date('2026-05-17T00:00:00Z'),
      }),
    );

    const result = await service.updateDatasetMetadata(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      { name: 'risk-eval-renamed', description: 'renamed samples' },
      actor,
    );

    expect(result.name).toBe('risk-eval-renamed');
    expect(repo.updateDatasetMetadata).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      { name: 'risk-eval-renamed', description: 'renamed samples' },
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'storage',
        eventType: 'dataset.updated',
        idempotencyKey: expect.stringContaining('storage:dataset.updated:22222222-2222-4222-8222-222222222222'),
      }),
    );
  });

  it('rejects metadata updates when the target name is already used', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findDatasetById.mockResolvedValue(datasetRow());
    repo.findDatasetByProjectAndName.mockResolvedValue(
      datasetRow({ id: '22222222-2222-4222-8222-222222222223', name: 'risk-eval-v5' }),
    );

    await expect(
      service.updateDatasetMetadata(
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222',
        { name: 'risk-eval-v5', description: null },
        actor,
      ),
    ).rejects.toThrow(new ConflictException('dataset_name_taken'));

    expect(repo.updateDatasetMetadata).not.toHaveBeenCalled();
  });

  describe('deleteDatasetSamples', () => {
    const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
    const DATASET_ID = '22222222-2222-4222-8222-222222222222';
    const SAMPLE_IDS = ['33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302'];

    it('hard deletes samples and decrements sample count', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetById.mockResolvedValue(datasetRow({ sampleCount: 5 }));
      repo.countDatasetReferences.mockResolvedValue(new Map([[DATASET_ID, { experiments: 0, optimizations: 0 }]]));
      repo.hardDeleteSamples.mockResolvedValue(2);

      const result = await service.deleteDatasetSamples(PROJECT_ID, DATASET_ID, { sampleIds: SAMPLE_IDS }, actor);

      expect(result).toEqual({ deleted: 2 });
      expect(repo.hardDeleteSamples).toHaveBeenCalledWith(DATASET_ID, SAMPLE_IDS);
      expect(repo.decrementDatasetSampleCount).toHaveBeenCalledWith(DATASET_ID, 2);
      expect(usageMetering.record).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'storage',
          eventType: 'dataset.updated',
          idempotencyKey: expect.stringContaining(`storage:dataset.updated:${DATASET_ID}`),
        }),
      );
    });

    it('rejects deletion when dataset is referenced by experiments', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetById.mockResolvedValue(datasetRow());
      repo.countDatasetReferences.mockResolvedValue(new Map([[DATASET_ID, { experiments: 1, optimizations: 0 }]]));

      await expect(
        service.deleteDatasetSamples(PROJECT_ID, DATASET_ID, { sampleIds: SAMPLE_IDS }, actor),
      ).rejects.toThrow(new ConflictException('dataset_samples_referenced'));

      expect(repo.hardDeleteSamples).not.toHaveBeenCalled();
      expect(repo.decrementDatasetSampleCount).not.toHaveBeenCalled();
    });

    it('rejects deletion when dataset is referenced by optimizations', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetById.mockResolvedValue(datasetRow());
      repo.countDatasetReferences.mockResolvedValue(new Map([[DATASET_ID, { experiments: 0, optimizations: 2 }]]));

      await expect(
        service.deleteDatasetSamples(PROJECT_ID, DATASET_ID, { sampleIds: SAMPLE_IDS }, actor),
      ).rejects.toThrow(new ConflictException('dataset_samples_referenced'));

      expect(repo.hardDeleteSamples).not.toHaveBeenCalled();
    });

    it('returns the real delete count when some sample ids do not belong to the dataset', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetById.mockResolvedValue(datasetRow({ sampleCount: 3 }));
      repo.countDatasetReferences.mockResolvedValue(new Map([[DATASET_ID, { experiments: 0, optimizations: 0 }]]));
      repo.hardDeleteSamples.mockResolvedValue(1);

      const result = await service.deleteDatasetSamples(PROJECT_ID, DATASET_ID, { sampleIds: SAMPLE_IDS }, actor);

      expect(result).toEqual({ deleted: 1 });
      expect(repo.decrementDatasetSampleCount).toHaveBeenCalledWith(DATASET_ID, 1);
    });
  });
});

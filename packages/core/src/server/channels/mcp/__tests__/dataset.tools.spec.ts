import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { DatasetService } from '../../../modules/dataset/dataset.service';
import { dispatchTool } from '../mcp-server.factory';
import { createDatasetTools } from '../dataset.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DATASET_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_ID = '33333333-3333-4333-8333-333333333333';

const actor = {
  sub: 'mcp-user-token-1',
  actorId: 'mcp-user-token-1',
  actorKind: 'system_mcp' as const,
  projectId: PROJECT_ID,
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const context: McpToolContext = {
  actorUserId: actor.actorId,
  actor,
  project: { projectId: PROJECT_ID, source: 'local' },
};

function serviceStub(): DatasetService {
  return {
    listDatasets: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getDataset: vi.fn().mockResolvedValue({ id: DATASET_ID }),
    listDatasetSamples: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    // exportDataset's handler reads file.createStream() and returns the content as base64.
    exportDataset: vi.fn().mockResolvedValue({
      createStream: () => Readable.from(['id,text\n1,hi\n']),
      contentType: 'text/csv; charset=utf-8',
      fileName: 'dataset.csv',
      format: 'csv',
    }),
    createDataset: vi.fn().mockResolvedValue({ dataset: { id: DATASET_ID }, sampleCount: 1 }),
    deleteDataset: vi.fn().mockResolvedValue(undefined),
    getDatasetDeleteImpact: vi
      .fn()
      .mockResolvedValue({ datasetId: DATASET_ID, experiments: [], optimizations: [], total: 0 }),
    archiveDataset: vi.fn().mockResolvedValue({ id: DATASET_ID }),
    restoreDataset: vi.fn().mockResolvedValue({ id: DATASET_ID }),
    updateDatasetMetadata: vi.fn().mockResolvedValue({ id: DATASET_ID }),
    deleteDatasetSamples: vi.fn().mockResolvedValue({ deleted: 0 }),
  } as unknown as DatasetService;
}

// A minimal-but-valid createDataset payload (createDatasetSchema): one field mapping + one sample.
function validCreatePayload() {
  return {
    name: 'mcp dataset',
    description: 'from mcp',
    uploadSource: { fileName: 'data.csv', fileSizeBytes: 128 },
    fieldMappings: [{ name: 'question', role: 'text' }],
    samples: [{ question: 'hello' }],
  };
}

describe('MCP dataset tools', () => {
  it('exposes the dataset tool surface 1:1', () => {
    const names = createDatasetTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'dataset_list_datasets',
      'dataset_get_dataset',
      'dataset_list_samples',
      'dataset_export_dataset',
      'dataset_create_dataset',
      'dataset_delete_dataset',
      'dataset_get_delete_impact',
      'dataset_archive_dataset',
      'dataset_restore_dataset',
      'dataset_update_metadata',
      'dataset_delete_samples',
    ]);
  });

  it('dataset_list_datasets: delegates to the service scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createDatasetTools(service), 'dataset_list_datasets', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.listDatasets).toHaveBeenCalledTimes(1);
    expect(service.listDatasets).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('dataset_get_dataset: delegates the dataset id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_get_dataset',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, actor);
  });

  it('dataset_get_dataset: non-uuid datasetId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_get_dataset',
      { datasetId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getDataset).not.toHaveBeenCalled();
  });

  it('dataset_list_samples: delegates the parsed paging query scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_list_samples',
      { datasetId: DATASET_ID, page: 2, pageSize: 100, search: 'foo' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listDatasetSamples).toHaveBeenCalledWith(
      PROJECT_ID,
      DATASET_ID,
      actor,
      expect.objectContaining({ page: 2, pageSize: 100, search: 'foo' }),
    );
  });

  it('dataset_list_samples: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_list_samples',
      { datasetId: 'nope', page: 1 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listDatasetSamples).not.toHaveBeenCalled();
  });

  it('dataset_list_samples: out-of-range pageSize is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_list_samples',
      { datasetId: DATASET_ID, pageSize: 9999 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listDatasetSamples).not.toHaveBeenCalled();
  });

  it('dataset_export_dataset: delegates the requested format scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_export_dataset',
      { datasetId: DATASET_ID, format: 'jsonl' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.exportDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, 'jsonl', actor);
  });

  it('dataset_export_dataset: defaults format to csv when omitted', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_export_dataset',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.exportDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, 'csv', actor);
  });

  it('dataset_export_dataset: unsupported format is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_export_dataset',
      { datasetId: DATASET_ID, format: 'xlsx' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.exportDataset).not.toHaveBeenCalled();
  });

  it('dataset_create_dataset: delegates the parsed DTO scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_create_dataset',
      validCreatePayload(),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createDataset).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        name: 'mcp dataset',
        fieldMappings: [{ name: 'question', role: 'text' }],
        samples: [{ question: 'hello' }],
      }),
      actor,
    );
  });

  it('dataset_create_dataset: missing required fields is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_create_dataset',
      { name: 'incomplete' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createDataset).not.toHaveBeenCalled();
  });

  it('dataset_create_dataset: more than one expected field is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_create_dataset',
      {
        ...validCreatePayload(),
        fieldMappings: [
          { name: 'a', role: 'expected' },
          { name: 'b', role: 'expected' },
        ],
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createDataset).not.toHaveBeenCalled();
  });

  it('dataset_delete_dataset: delegates the dataset id and returns ok', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_delete_dataset',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.deleteDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, actor);
  });

  it('dataset_delete_dataset: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_delete_dataset',
      { datasetId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.deleteDataset).not.toHaveBeenCalled();
  });

  it('dataset_get_delete_impact: delegates the dataset id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_get_delete_impact',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getDatasetDeleteImpact).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, actor);
  });

  it('dataset_get_delete_impact: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_get_delete_impact',
      { datasetId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.getDatasetDeleteImpact).not.toHaveBeenCalled();
  });

  it('dataset_archive_dataset: delegates the dataset id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_archive_dataset',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.archiveDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, actor);
  });

  it('dataset_archive_dataset: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_archive_dataset',
      { datasetId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.archiveDataset).not.toHaveBeenCalled();
  });

  it('dataset_restore_dataset: delegates the dataset id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_restore_dataset',
      { datasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.restoreDataset).toHaveBeenCalledWith(PROJECT_ID, DATASET_ID, actor);
  });

  it('dataset_restore_dataset: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_restore_dataset',
      { datasetId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.restoreDataset).not.toHaveBeenCalled();
  });

  it('dataset_update_metadata: delegates the parsed DTO scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_update_metadata',
      {
        datasetId: DATASET_ID,
        name: 'renamed',
        description: 'updated',
        fieldMappings: [{ name: 'label', role: 'expected' }],
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.updateDatasetMetadata).toHaveBeenCalledWith(
      PROJECT_ID,
      DATASET_ID,
      expect.objectContaining({
        name: 'renamed',
        description: 'updated',
        fieldMappings: [{ name: 'label', role: 'expected' }],
      }),
      actor,
    );
  });

  it('dataset_update_metadata: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_update_metadata',
      { datasetId: 'bad', name: 'renamed' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateDatasetMetadata).not.toHaveBeenCalled();
  });

  it('dataset_update_metadata: empty name is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_update_metadata',
      { datasetId: DATASET_ID, name: '' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateDatasetMetadata).not.toHaveBeenCalled();
  });

  it('dataset_delete_samples: delegates the parsed sampleIds scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_delete_samples',
      { datasetId: DATASET_ID, sampleIds: [SAMPLE_ID] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.deleteDatasetSamples).toHaveBeenCalledWith(
      PROJECT_ID,
      DATASET_ID,
      expect.objectContaining({ sampleIds: [SAMPLE_ID] }),
      actor,
    );
  });

  it('dataset_delete_samples: non-uuid datasetId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_delete_samples',
      { datasetId: 'bad', sampleIds: [SAMPLE_ID] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.deleteDatasetSamples).not.toHaveBeenCalled();
  });

  it('dataset_delete_samples: non-uuid entries in sampleIds is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetTools(service),
      'dataset_delete_samples',
      { datasetId: DATASET_ID, sampleIds: ['not-a-uuid'] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.deleteDatasetSamples).not.toHaveBeenCalled();
  });
});

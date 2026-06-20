import { describe, expect, it, vi } from 'vitest';
import type { DatasetImportService } from '../../../modules/dataset/dataset-import.service';
import { dispatchTool } from '../mcp-server.factory';
import { createDatasetImportTools } from '../dataset-import.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const IMPORT_ID = '22222222-2222-4222-8222-222222222222';

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

function serviceStub(): DatasetImportService {
  return {
    createImport: vi.fn().mockResolvedValue({ id: IMPORT_ID }),
    getRawImportCapabilities: vi.fn().mockResolvedValue({ supported: false, maxBytes: 2_147_483_648 }),
    createRawImport: vi.fn().mockResolvedValue({
      import: { id: IMPORT_ID },
      uploadSession: {
        sessionId: 'up-1',
        url: 'https://storage.example/upload',
        expiresAt: '2026-06-20T00:00:00.000Z',
      },
      maxBytes: 2_147_483_648,
    }),
    getImport: vi.fn().mockResolvedValue({ id: IMPORT_ID }),
    appendBatch: vi.fn().mockResolvedValue({ importId: IMPORT_ID, receivedRows: 1 }),
    complete: vi.fn().mockResolvedValue({ dataset: { id: IMPORT_ID }, sampleCount: 1 }),
    abort: vi.fn().mockResolvedValue(undefined),
  } as unknown as DatasetImportService;
}

// A minimal-but-valid createImport payload (createDatasetImportSchema).
function validCreatePayload() {
  return {
    name: 'mcp import',
    description: 'streamed',
    fieldMappings: [{ name: 'question', role: 'text' }],
    sourceFile: { fileName: 'big.jsonl', fileSizeBytes: 4096 },
    sourceFormat: 'jsonl',
    declaredTotalRows: 1000,
  };
}

describe('MCP dataset-import tools', () => {
  it('exposes the dataset-import tool surface 1:1', () => {
    const names = createDatasetImportTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'dataset_import_create',
      'dataset_import_raw_capabilities',
      'dataset_import_create_raw',
      'dataset_import_get',
      'dataset_import_append_batch',
      'dataset_import_complete',
      'dataset_import_abort',
    ]);
  });

  it('dataset_import_raw_capabilities: delegates scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_raw_capabilities',
      {},
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getRawImportCapabilities).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('dataset_import_create_raw: delegates the parsed DTO scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_create_raw',
      { ...validCreatePayload(), sourceFormat: 'csv', sourceFile: { fileName: 'large.csv', fileSizeBytes: 4096 } },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createRawImport).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ sourceFormat: 'csv' }),
      actor,
    );
  });

  it('dataset_import_create: delegates the parsed DTO scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_create',
      validCreatePayload(),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createImport).toHaveBeenCalledTimes(1);
    expect(service.createImport).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        name: 'mcp import',
        sourceFormat: 'jsonl',
        fieldMappings: [{ name: 'question', role: 'text' }],
      }),
      actor,
    );
  });

  it('dataset_import_create: missing required fields is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_create',
      { name: 'incomplete' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createImport).not.toHaveBeenCalled();
  });

  it('dataset_import_create: unsupported sourceFormat is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_create',
      { ...validCreatePayload(), sourceFormat: 'xml' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createImport).not.toHaveBeenCalled();
  });

  it('dataset_import_get: delegates the import id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_get',
      { importId: IMPORT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getImport).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, actor);
  });

  it('dataset_import_get: non-uuid importId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_get',
      { importId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getImport).not.toHaveBeenCalled();
  });

  it('dataset_import_append_batch: delegates the parsed batch DTO scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_append_batch',
      { importId: IMPORT_ID, batchStartIndex: 0, samples: [{ question: 'hello' }] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.appendBatch).toHaveBeenCalledWith(
      PROJECT_ID,
      IMPORT_ID,
      expect.objectContaining({ batchStartIndex: 0, samples: [{ question: 'hello' }] }),
      actor,
    );
  });

  it('dataset_import_append_batch: non-uuid importId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_append_batch',
      { importId: 'bad', batchStartIndex: 0, samples: [{ question: 'hello' }] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.appendBatch).not.toHaveBeenCalled();
  });

  it('dataset_import_append_batch: empty samples is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_append_batch',
      { importId: IMPORT_ID, batchStartIndex: 0, samples: [] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.appendBatch).not.toHaveBeenCalled();
  });

  it('dataset_import_append_batch: negative batchStartIndex is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_append_batch',
      { importId: IMPORT_ID, batchStartIndex: -1, samples: [{ question: 'hello' }] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.appendBatch).not.toHaveBeenCalled();
  });

  it('dataset_import_complete: delegates the import id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_complete',
      { importId: IMPORT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.complete).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, actor);
  });

  it('dataset_import_complete: non-uuid importId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_complete',
      { importId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.complete).not.toHaveBeenCalled();
  });

  it('dataset_import_abort: delegates the import id and returns ok', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_abort',
      { importId: IMPORT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.abort).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, actor);
  });

  it('dataset_import_abort: non-uuid importId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createDatasetImportTools(service),
      'dataset_import_abort',
      { importId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.abort).not.toHaveBeenCalled();
  });
});

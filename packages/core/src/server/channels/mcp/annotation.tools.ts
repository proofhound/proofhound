import {
  claimAnnotationSamplesInputSchema,
  createAnnotationTaskInputSchema,
  releaseAnnotationSampleInputSchema,
  submitAnnotationSampleInputSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { McpToolDefinition } from './mcp.types';
import type { AnnotationService } from '../../modules/annotation/annotation.service';

const uuidParam = z.string().uuid();

export function createAnnotationTools(service: AnnotationService): McpToolDefinition[] {
  return [
    {
      name: 'annotation_task_list',
      description: '列出人工创建的标注任务',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.listTasks(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_task_options',
      description: '列出可创建标注任务的发布名称、发布版本、分类选项、run result 总量及按分类聚合的数量',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.listOptions(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_task_create',
      description: '按发布名称、发布版本和抽样配置创建标注任务，支持随机抽取或按 run result 分类指定数量',
      inputSchema: {
        type: 'object',
        required: ['name', 'releaseLineId', 'releaseVersionId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          releaseLineId: { type: 'string', format: 'uuid' },
          releaseVersionId: { type: 'string', format: 'uuid' },
          releaseVersionScope: { type: 'string', enum: ['exact', 'journey'] },
          scope: { type: 'string', enum: ['all', 'canary', 'online'] },
          samplingMode: { type: 'string', enum: ['random', 'per_category'] },
          sampleSize: { type: 'integer', minimum: 1, maximum: 10000 },
          categorySampleCounts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['category', 'sampleSize'],
              properties: {
                category: { type: 'string', minLength: 1 },
                sampleSize: { type: 'integer', minimum: 0, maximum: 10000 },
              },
            },
          },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const body = createAnnotationTaskInputSchema.parse(input);
        return service.createTask(projectId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_sample_list',
      description: '列出标注任务样本',
      inputSchema: {
        type: 'object',
        required: ['taskId'],
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['pending', 'claimed', 'submitted'] },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const taskId = uuidParam.parse(input.taskId);
        const status = z.enum(['pending', 'claimed', 'submitted']).optional().parse(input.status);
        const limit = z.coerce.number().int().min(1).max(200).default(80).parse(input.limit);
        const offset = z.coerce.number().int().min(0).default(0).parse(input.offset);
        return service.listSamples(projectId, taskId, { status, limit, offset }, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_sample_claim',
      description: '领取标注任务样本',
      inputSchema: {
        type: 'object',
        required: ['taskId', 'batchSize'],
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          batchSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const taskId = uuidParam.parse(input.taskId);
        const body = claimAnnotationSamplesInputSchema.parse({ batchSize: input.batchSize });
        return service.claimSamples(projectId, taskId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_sample_submit',
      description: '提交样本的人工 expected_output 分类标注',
      inputSchema: {
        type: 'object',
        required: ['taskId', 'annotationId', 'expectedOutput'],
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          annotationId: { type: 'string', format: 'uuid' },
          expectedOutput: { type: 'string', minLength: 1, maxLength: 4000 },
          notes: { type: ['string', 'null'], maxLength: 4000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const taskId = uuidParam.parse(input.taskId);
        const body = submitAnnotationSampleInputSchema.parse({
          annotationId: input.annotationId,
          expectedOutput: input.expectedOutput,
          notes: input.notes ?? null,
        });
        return service.submitSample(projectId, taskId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'annotation_sample_release',
      description: '释放当前用户锁定的标注样本',
      inputSchema: {
        type: 'object',
        required: ['taskId', 'annotationId'],
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          annotationId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const taskId = uuidParam.parse(input.taskId);
        const body = releaseAnnotationSampleInputSchema.parse({ annotationId: input.annotationId });
        return service.releaseSample(projectId, taskId, body, getMcpActor(ctx));
      },
    },
  ];
}

import { renderPromptForSample } from '../experiment.renderer';
import type { PromptVariableDto } from '@proofhound/shared';

const baseVariable = (overrides: Partial<PromptVariableDto> = {}): PromptVariableDto => ({
  name: 'text',
  type: 'text',
  required: true,
  ...overrides,
});

describe('renderPromptForSample', () => {
  it('replaces {{var}} placeholders using datasetField when present', () => {
    const result = renderPromptForSample(
      {
        body: '请判断: {{text}}',
        variables: [baseVariable({ name: 'text', datasetField: 'review' })],
        outputSchema: { fields: [] },
      },
      { data: { review: '不错' } },
    );
    expect(result.renderedPrompt.prompt).toBe('请判断: 不错');
    expect(result.renderedPrompt.messages?.[0]?.content).toBe('请判断: 不错');
    expect(result.inputVariables).toEqual({ text: '不错' });
  });

  it('falls back to variable.name when datasetField is empty', () => {
    const result = renderPromptForSample(
      {
        body: '请判断: {{text}}',
        variables: [baseVariable({ name: 'text' })],
        outputSchema: { fields: [] },
      },
      { data: { text: '一般' } },
    );
    expect(result.renderedPrompt.prompt).toBe('请判断: 一般');
  });

  it('keeps placeholder when variable not in inputVariables', () => {
    const result = renderPromptForSample(
      {
        body: 'unresolved: {{missing}}',
        variables: [],
        outputSchema: null,
      },
      { data: {} },
    );
    expect(result.renderedPrompt.prompt).toBe('unresolved: {{missing}}');
  });

  it('builds imageRefs for image_url variables', () => {
    const result = renderPromptForSample(
      {
        body: '看图: {{photo}}',
        variables: [baseVariable({ name: 'photo', type: 'image_url', datasetField: 'image_url' })],
        outputSchema: null,
      },
      { data: { image_url: 'https://example.com/a.png' } },
    );
    expect(result.renderedPrompt.imageRefs).toEqual([
      { name: 'photo', type: 'image_url', value: 'https://example.com/a.png' },
    ]);
  });

  it('expands a single image field array into multiple imageRefs without splitting URLs', () => {
    const result = renderPromptForSample(
      {
        body: '看图: {{photos}}',
        variables: [baseVariable({ name: 'photos', type: 'image', datasetField: 'image_urls' })],
        outputSchema: null,
      },
      {
        data: {
          image_urls: ['https://example.com/a,b.png?token=1;2', 'data:image/png;base64,iVBORw0KGgo='],
        },
      },
    );

    expect(result.renderedPrompt.imageRefs).toEqual([
      { name: 'photos', type: 'image_url', value: 'https://example.com/a,b.png?token=1;2', index: 0 },
      { name: 'photos', type: 'image_base64', value: 'data:image/png;base64,iVBORw0KGgo=', index: 1 },
    ]);
    expect(result.inputVariables).toEqual({
      photos: ['https://example.com/a,b.png?token=1;2', 'data:image/png;base64,iVBORw0KGgo='],
    });
  });

  it('keeps multiple image fields as separate imageRefs', () => {
    const result = renderPromptForSample(
      {
        body: '对比 {{front}} 和 {{back}}',
        variables: [
          baseVariable({ name: 'front', type: 'image_url', datasetField: 'front_image' }),
          baseVariable({ name: 'back', type: 'image_url', datasetField: 'back_image' }),
        ],
        outputSchema: null,
      },
      {
        data: {
          front_image: 'https://example.com/front.png',
          back_image: 'https://example.com/back.png',
        },
      },
    );

    expect(result.renderedPrompt.imageRefs).toEqual([
      { name: 'front', type: 'image_url', value: 'https://example.com/front.png' },
      { name: 'back', type: 'image_url', value: 'https://example.com/back.png' },
    ]);
  });

  it('builds responseFormat with required keys from outputSchema', () => {
    const result = renderPromptForSample(
      {
        body: '...',
        variables: [],
        outputSchema: {
          fields: [
            { key: 'label', value: 'positive 或 negative', isJudgment: true },
            { key: 'reason', value: '简短理由', isJudgment: false },
          ],
        },
      },
      { data: {} },
    );
    expect(result.renderedPrompt.responseFormat).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'positive 或 negative' },
            reason: { type: 'string', description: '简短理由' },
          },
          required: ['label', 'reason'],
          additionalProperties: false,
        },
      },
    });
  });

  it('returns no responseFormat when outputSchema is null or empty', () => {
    expect(
      renderPromptForSample({ body: '', variables: [], outputSchema: null }, { data: {} }).renderedPrompt
        .responseFormat,
    ).toBeUndefined();
    expect(
      renderPromptForSample({ body: '', variables: [], outputSchema: { fields: [] } }, { data: {} }).renderedPrompt
        .responseFormat,
    ).toBeUndefined();
  });

  it('appends 输出格式 section containing "json" to user content when outputSchema has fields', () => {
    // Regression guard: Alibaba DashScope (OpenAI-compatible) requires messages to contain the literal "json" before
    // response_format is allowed to be json mode; bodies produced by optimization do not include "json", so the renderer must auto-inject it.
    const result = renderPromptForSample(
      {
        body: '判断 {{text}} 的情感',
        variables: [baseVariable({ name: 'text', datasetField: 'review' })],
        outputSchema: {
          fields: [
            { key: 'label', value: 'positive 或 negative', isJudgment: true },
            { key: 'reason', value: '简短理由', isJudgment: false },
          ],
        },
      },
      { data: { review: '不错' } },
    );
    const content = result.renderedPrompt.messages?.[0]?.content ?? '';
    expect(content).toContain('判断 不错 的情感');
    expect(content).toContain('## 输出格式');
    expect(content).toContain('json');
    expect(content).toContain('```json');
    expect(content).toContain('"label":');
    expect(content).toContain('"reason":');
    // The prompt field must stay consistent with the messages content
    expect(result.renderedPrompt.prompt).toBe(content);
  });

  it('keeps user content unchanged when outputSchema is null or empty', () => {
    const r1 = renderPromptForSample({ body: 'plain body', variables: [], outputSchema: null }, { data: {} });
    expect(r1.renderedPrompt.messages?.[0]?.content).toBe('plain body');

    const r2 = renderPromptForSample({ body: 'plain body', variables: [], outputSchema: { fields: [] } }, { data: {} });
    expect(r2.renderedPrompt.messages?.[0]?.content).toBe('plain body');
  });
});

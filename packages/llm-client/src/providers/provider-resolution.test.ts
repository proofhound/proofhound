import { describe, expect, it } from 'vitest';
import { resolveLLMAdapter } from '../invoke';

describe('provider resolution', () => {
  it('maps mainstream OpenAI-compatible provider types to the chat completions adapter', () => {
    for (const providerType of ['deepseek', 'kimi', 'minimax', 'qwen', 'ernie']) {
      const adapter = resolveLLMAdapter(providerType);

      expect(adapter.providerType).toBe('openai');
      expect(adapter.buildRequestLog).toBe(resolveLLMAdapter('openai').buildRequestLog);
    }
  });

  it('normalizes case and underscores before resolving provider types', () => {
    expect(resolveLLMAdapter('DeepSeek').providerType).toBe('openai');
    expect(resolveLLMAdapter('AZURE_OPENAI').providerType).toBe('azure-openai');
  });
});

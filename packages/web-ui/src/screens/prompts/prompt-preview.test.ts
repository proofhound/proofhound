import { describe, expect, it } from 'vitest';
import { composePromptPreview } from './prompt-preview';

describe('composePromptPreview', () => {
  it('renders the output format instruction in the selected prompt language', () => {
    const preview = composePromptPreview({
      body: 'Classify {{ticket}}',
      promptLanguage: 'en-US',
      outputFields: [
        { key: 'intent', value: 'billing / shipping', isJudgment: true },
        { key: 'reason', value: 'Short explanation', isJudgment: false },
      ],
    });

    expect(preview).toContain('Classify {{ticket}}\n\n## Output Format');
    expect(preview).toContain('Output only a JSON object');
    expect(preview).toContain('"intent": <string>');
    expect(preview).toContain('Short explanation');
    expect(preview).not.toContain('## 输出格式');
  });

  it('defaults to the Chinese output format instruction for zh-CN', () => {
    const preview = composePromptPreview({
      body: '判断 {{text}}',
      promptLanguage: 'zh-CN',
      outputFields: [{ key: 'label', value: '正向 或 负向', isJudgment: true }],
    });

    expect(preview).toContain('判断 {{text}}\n\n## 输出格式');
    expect(preview).toContain('请严格按以下 JSON 输出');
    expect(preview).toContain('"label": <string>');
    expect(preview).toContain('正向 或 负向');
  });
});

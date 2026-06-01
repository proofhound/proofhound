import { describe, expect, it } from 'vitest';
import {
  compactHumanValue,
  datasetFieldDisplays,
  getModelOutputFieldValue,
  getModelOutputValue,
  getRenderedPromptMessages,
  hasStructuredModelOutput,
  splitVariableDisplays,
} from './run-result-display';

describe('run-result-display', () => {
  it('splits text and image variables using names and image-like values', () => {
    const variables = splitVariableDisplays({
      user_request: 'Show high risk SQL',
      screenshot_image: 'https://example.test/sql-risk.png',
      receipt: { image_url: 'https://example.test/receipt' },
    });

    expect(variables.text.map((item) => item.name)).toEqual(['user_request']);
    expect(variables.image.map((item) => item.name)).toEqual(['screenshot_image', 'receipt']);
  });

  it('renders dataset field values without relying on prompt input variables', () => {
    const displays = datasetFieldDisplays(
      [
        { name: 'user_request', role: 'text', value: 'Dataset request text' },
        { name: 'device', role: 'text', value: 'mobile' },
      ],
      'text',
    );

    expect(displays).toMatchObject([
      { name: 'user_request', value: 'Dataset request text', kind: 'text' },
      { name: 'device', value: 'mobile', kind: 'text' },
    ]);
  });

  it('uses parsed output before raw JSON when building a model output preview', () => {
    const output = getModelOutputValue({
      parsedOutput: { risk: 'low', reason: 'safe' },
      rawResponse: '{"risk":"high"}',
      decisionOutput: 'high',
      errorMessage: null,
    });

    expect(compactHumanValue(output)).toBe('risk: low · reason: safe');
  });

  it('returns an empty list when dataset fields are missing on the response', () => {
    expect(datasetFieldDisplays(undefined, 'text')).toEqual([]);
    expect(datasetFieldDisplays(null, 'image')).toEqual([]);
  });

  it('reports structured model output only when parsedOutput is a record', () => {
    expect(hasStructuredModelOutput({ parsedOutput: { risk: 'low' } })).toBe(true);
    expect(hasStructuredModelOutput({ parsedOutput: null })).toBe(false);
    expect(hasStructuredModelOutput({ parsedOutput: 'plain string' })).toBe(false);
    expect(hasStructuredModelOutput({ parsedOutput: [1, 2, 3] })).toBe(false);
  });

  it('reads a single field from structured parsedOutput by key', () => {
    expect(getModelOutputFieldValue({ parsedOutput: { risk: 'low', reason: 'safe' } }, 'risk')).toBe('low');
    expect(getModelOutputFieldValue({ parsedOutput: { risk: 'low' } }, 'reason')).toBeUndefined();
    expect(getModelOutputFieldValue({ parsedOutput: null }, 'risk')).toBeUndefined();
    expect(getModelOutputFieldValue({ parsedOutput: 'not-a-record' }, 'risk')).toBeUndefined();
  });

  it('extracts rendered prompt messages from structured prompt payloads', () => {
    const messages = getRenderedPromptMessages({
      messages: [
        { role: 'system', content: 'Classify risk' },
        { role: 'user', content: 'SELECT * FROM users' },
      ],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'Classify risk' },
      { role: 'user', content: 'SELECT * FROM users' },
    ]);
  });
});

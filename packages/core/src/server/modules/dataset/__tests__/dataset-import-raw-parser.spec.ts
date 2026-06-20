import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DatasetImportSourceFormat } from '@proofhound/shared';
import { parseRawDatasetRows } from '../dataset-import-raw-parser';

async function collectRows(
  chunks: Array<Buffer | string>,
  sourceFormat: DatasetImportSourceFormat,
  options?: { maxLineBytes?: number },
) {
  const rows: Array<Record<string, unknown>> = [];
  for await (const row of parseRawDatasetRows(Readable.from(chunks), sourceFormat, options)) {
    rows.push(row);
  }
  return rows;
}

describe('parseRawDatasetRows', () => {
  it('rejects JSONL rows over the configured line byte limit', async () => {
    await expect(collectRows(['{"text":"abcdef"}\n'], 'jsonl', { maxLineBytes: 8 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });

  it('keeps UTF-8 characters intact when JSONL chunks split a multibyte boundary', async () => {
    const encoded = Buffer.from('{"text":"split 😀 boundary"}\n', 'utf8');
    const emojiStart = encoded.indexOf(Buffer.from('😀', 'utf8'));

    const rows = await collectRows(
      [
        encoded.subarray(0, emojiStart + 1),
        encoded.subarray(emojiStart + 1, emojiStart + 3),
        encoded.subarray(emojiStart + 3),
      ],
      'jsonl',
    );

    expect(rows).toEqual([{ text: 'split 😀 boundary' }]);
  });

  it('parses CSV quoted commas, quoted newlines, and escaped quotes', async () => {
    const rows = await collectRows(
      [['sample_id,text,expected_output', 'case-1,"hello, ""world""', 'with newline",positive'].join('\n')],
      'csv',
    );

    expect(rows).toEqual([
      {
        sample_id: 'case-1',
        text: 'hello, "world"\nwith newline',
        expected_output: 'positive',
      },
    ]);
  });

  it('parses TSV rows and recognizes valid JSON array cells', async () => {
    const rows = await collectRows(
      [
        'sample_id\timage_urls\texpected_output\ncase-1\t["https://example.test/a,b.png","data:image/png;base64,AAAA"]\tpass\n',
      ],
      'tsv',
    );

    expect(rows).toEqual([
      {
        sample_id: 'case-1',
        image_urls: ['https://example.test/a,b.png', 'data:image/png;base64,AAAA'],
        expected_output: 'pass',
      },
    ]);
  });

  it('rejects CSV rows over the configured parser byte guard', async () => {
    await expect(collectRows([`id,text\n1,${'x'.repeat(32)}\n`], 'csv', { maxLineBytes: 12 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });

  it('rejects TSV rows over the configured parser byte guard', async () => {
    await expect(collectRows([`id\ttext\n1\t${'x'.repeat(32)}\n`], 'tsv', { maxLineBytes: 12 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });
});

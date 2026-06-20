import { describe, expect, it } from 'vitest';

import {
  DATASET_IMAGE_SAMPLE_DOWNLOADS,
  estimateUploadProgressBytes,
  formatFileSize,
  projectBufferedSampleBatches,
  selectDatasetUploadImportPath,
} from '../dataset-upload-page';

describe('DatasetUploadPage import helpers', () => {
  it('formats upload byte limits at the expected units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('exposes downloadable image sample datasets for every supported image shape', () => {
    expect(DATASET_IMAGE_SAMPLE_DOWNLOADS).toEqual([
      expect.objectContaining({ href: expect.stringContaining('image-url-fields.csv') }),
      expect.objectContaining({ href: expect.stringContaining('image-url-array.csv') }),
      expect.objectContaining({ href: expect.stringContaining('image-base64.jsonl') }),
      expect.objectContaining({ href: expect.stringContaining('image-zip-relative-paths.zip') }),
    ]);
  });

  it('estimates upload progress from the source file size', () => {
    expect(estimateUploadProgressBytes({ fileName: 'train.csv', fileSizeBytes: 5_900_000 })).toBe(5_900_000);
    expect(estimateUploadProgressBytes({ fileName: 'empty.csv', fileSizeBytes: 0 })).toBe(1);
  });

  it('selects raw import only for very large streaming files when the provider supports upload sessions', () => {
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 300 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('raw');

    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 300 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: false, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');
  });

  it('keeps medium streaming files on the client-streamed path even when raw import is available', () => {
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.tsv', size: 64 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');
  });

  it('selects buffered import when a small parsed file exceeds the synchronous sample-count guard', () => {
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.jsonl', size: 1024 },
        isLargeFile: false,
        parsedSampleCount: 5001,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('buffered');
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.jsonl', size: 1024 },
        isLargeFile: false,
        parsedSampleCount: 5000,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('sync');
  });

  it('projects buffered import samples lazily by batch', async () => {
    let thirdRowTouched = false;
    const thirdRow = new Proxy(
      { sample_id: 'case-3', text: 'third', ignored: 'nope' },
      {
        get(target, property, receiver) {
          if (property === 'text') {
            thirdRowTouched = true;
            throw new Error('third row should not be read with the first batch');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const iterator = projectBufferedSampleBatches(
      [
        { sample_id: 'case-1', text: 'first', ignored: 'nope' },
        { sample_id: 'case-2', text: 'second', ignored: 'nope' },
        thirdRow,
      ],
      ['sample_id', 'text'],
      2,
    );

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: [
        { sample_id: 'case-1', text: 'first' },
        { sample_id: 'case-2', text: 'second' },
      ],
    });
    expect(thirdRowTouched).toBe(false);

    await expect(iterator.next()).rejects.toThrow('third row should not be read with the first batch');
    expect(thirdRowTouched).toBe(true);
  });
});

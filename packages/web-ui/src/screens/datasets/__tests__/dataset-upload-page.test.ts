import { describe, expect, it } from 'vitest';

import {
  DATASET_IMAGE_SAMPLE_DOWNLOADS,
  estimateUploadProgressBytes,
  formatFileSize,
  getDatasetImageSampleDownloadHref,
  projectBufferedSampleBatches,
  selectSingleDatasetUploadFile,
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
      expect.objectContaining({ fileName: 'proofhound-image-url-fields.csv', mimeType: 'text/csv;charset=utf-8' }),
      expect.objectContaining({ fileName: 'proofhound-image-url-array.csv', mimeType: 'text/csv;charset=utf-8' }),
      expect.objectContaining({
        fileName: 'proofhound-image-base64.jsonl',
        mimeType: 'application/x-ndjson;charset=utf-8',
      }),
      expect.objectContaining({ fileName: 'proofhound-image-zip-relative-paths.zip', mimeType: 'application/zip' }),
    ]);
    const urlFieldsSample = DATASET_IMAGE_SAMPLE_DOWNLOADS.find(
      (sample) => sample.fileName === 'proofhound-image-url-fields.csv',
    );
    const zipSample = DATASET_IMAGE_SAMPLE_DOWNLOADS.find(
      (sample) => sample.fileName === 'proofhound-image-zip-relative-paths.zip',
    );
    expect(urlFieldsSample).toBeDefined();
    expect(zipSample).toBeDefined();
    if (!urlFieldsSample || !zipSample) throw new Error('missing image sample download');

    expect(getDatasetImageSampleDownloadHref(urlFieldsSample)).toMatch(/^data:text\/csv;charset=utf-8,/);
    expect(decodeURIComponent(getDatasetImageSampleDownloadHref(urlFieldsSample))).toContain('front_image_url');
    expect(getDatasetImageSampleDownloadHref(zipSample)).toMatch(/^data:application\/zip;base64,UEs/);
  });

  it('estimates upload progress from the source file size', () => {
    expect(estimateUploadProgressBytes({ fileName: 'train.csv', fileSizeBytes: 5_900_000 })).toBe(5_900_000);
    expect(estimateUploadProgressBytes({ fileName: 'empty.csv', fileSizeBytes: 0 })).toBe(1);
  });

  it('rejects multi-file selections before parsing', async () => {
    await expect(
      selectSingleDatasetUploadFile([
        new File(['id\n1\n'], 'train.csv', { type: 'text/csv' }),
        new File(['id\n2\n'], 'extra.csv', { type: 'text/csv' }),
      ]),
    ).rejects.toThrow('single_file_only');
  });

  it('uses streaming batches for medium CSV/TSV/JSONL files and raw import past the raw threshold', () => {
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 2 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');

    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 300 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');

    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 600 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('raw');

    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.csv', size: 600 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: false, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');
  });

  it('routes bounded JSON files through raw import but does not raw-route oversized buffered formats', () => {
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.json', size: 32 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('raw');
    expect(
      selectDatasetUploadImportPath({
        file: { name: 'train.zip', size: 128 * 1024 * 1024 },
        isLargeFile: true,
        parsedSampleCount: 5,
        rawImportCapabilities: { supported: true, maxBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).toBe('streaming');
  });

  it('uses buffered import when a small parsed file exceeds the synchronous sample-count guard', () => {
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
        parsedSampleCount: 5001,
        rawImportCapabilities: { supported: false, maxBytes: 2 * 1024 * 1024 * 1024 },
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

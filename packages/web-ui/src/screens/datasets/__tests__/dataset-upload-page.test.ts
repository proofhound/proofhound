import { describe, expect, it } from 'vitest';

import {
  DATASET_IMAGE_SAMPLE_DOWNLOADS,
  formatFileSize,
  getDatasetImageSampleDownloadHref,
  selectSingleDatasetUploadFile,
  toUploadSourceFormat,
} from '../dataset-upload-page';

describe('DatasetUploadPage upload helpers', () => {
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

  it('maps file extensions to the upload source format', () => {
    expect(toUploadSourceFormat('train.csv')).toBe('csv');
    expect(toUploadSourceFormat('train.tsv')).toBe('tsv');
    expect(toUploadSourceFormat('train.jsonl')).toBe('jsonl');
    expect(toUploadSourceFormat('train.json')).toBe('json');
    expect(toUploadSourceFormat('train.zip')).toBe('zip');
    // Unknown / missing extensions default to JSONL line parsing on the server.
    expect(toUploadSourceFormat('train')).toBe('jsonl');
    expect(toUploadSourceFormat('TRAIN.CSV')).toBe('csv');
  });

  it('rejects multi-file selections before parsing', async () => {
    await expect(
      selectSingleDatasetUploadFile([
        new File(['id\n1\n'], 'train.csv', { type: 'text/csv' }),
        new File(['id\n2\n'], 'extra.csv', { type: 'text/csv' }),
      ]),
    ).rejects.toThrow('single_file_only');
  });
});

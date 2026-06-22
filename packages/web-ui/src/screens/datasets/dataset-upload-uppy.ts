import Uppy, { type UppyFile } from '@uppy/core';
import { useUppyState } from '@uppy/react';

export interface DatasetUploadUppyMeta {
  [key: string]: unknown;
  relativePath?: string;
}

export type DatasetUploadUppy = Uppy<DatasetUploadUppyMeta, Record<string, never>>;
type DatasetUploadUppyFile = UppyFile<DatasetUploadUppyMeta, Record<string, never>>;
type UploadFile = File & { proofhoundRelativePath?: string };

export function createDatasetUploadUppy(): DatasetUploadUppy {
  return new Uppy<DatasetUploadUppyMeta, Record<string, never>>({
    id: 'proofhound-dataset-upload',
    autoProceed: false,
    allowMultipleUploadBatches: false,
    restrictions: {
      minNumberOfFiles: 1,
    },
  });
}

export function replaceDatasetUploadUppyFiles(uppy: DatasetUploadUppy, files: File[]): File[] {
  clearDatasetUploadUppyFiles(uppy);

  for (const file of files) {
    const relativePath = getBrowserRelativePath(file);
    uppy.addFile({
      name: relativePath,
      type: file.type || undefined,
      data: file,
      meta: { relativePath },
    });
  }

  return getDatasetUploadUppyFiles(uppy);
}

export function clearDatasetUploadUppyFiles(uppy: DatasetUploadUppy): void {
  const ids = uppy.getFiles().map((file) => file.id);
  if (ids.length > 0) uppy.removeFiles(ids);
}

export function getDatasetUploadUppyFiles(uppy: DatasetUploadUppy): File[] {
  return uppy.getFiles().map((file) => toBrowserFile(file));
}

export function useDatasetUploadUppyFileCount(uppy: DatasetUploadUppy): number {
  return useUppyState(uppy, (state) => Object.keys(state.files).length);
}

function toBrowserFile(file: DatasetUploadUppyFile): File {
  if (!(file.data instanceof File)) {
    throw new Error('dataset_upload_file_missing');
  }
  const relativePath = typeof file.meta.relativePath === 'string' ? file.meta.relativePath : file.name;
  return withProofHoundRelativePath(file.data, relativePath);
}

function getBrowserRelativePath(file: File): string {
  const uploadFile = file as UploadFile;
  return uploadFile.proofhoundRelativePath || file.webkitRelativePath || file.name;
}

function withProofHoundRelativePath(file: File, relativePath: string): File {
  if (!relativePath || (file as UploadFile).proofhoundRelativePath === relativePath) return file;
  Object.defineProperty(file, 'proofhoundRelativePath', {
    configurable: true,
    value: relativePath,
  });
  return file;
}

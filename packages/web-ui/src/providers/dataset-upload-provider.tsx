'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { datasetImportClient } from '@proofhound/api-client';
import {
  DATASET_UPLOAD_MAX_BYTES,
  type DatasetImportStatusDto,
  type DatasetUploadMetadataDto,
} from '@proofhound/shared';

export interface DatasetUploadProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

export interface DatasetUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DatasetUploadProgress) => void;
}

// Swappable dataset upload transport (08 §3.13 frontend counterpart). OSS defaults to the multipart
// `POST /datasets/upload` client; a replacement shell injects its own (e.g. browser-direct-to-object-storage)
// through `WebContracts.datasetUpload`, reusing the rest of the dataset upload screen.
export type DatasetUploadAdapter = (
  projectId: string,
  file: Blob,
  metadata: DatasetUploadMetadataDto,
  options?: DatasetUploadOptions,
) => Promise<DatasetImportStatusDto>;

interface DatasetUploadContextValue {
  adapter: DatasetUploadAdapter;
  maxBytes: number;
}

const defaultAdapter: DatasetUploadAdapter = (projectId, file, metadata, options) =>
  datasetImportClient.uploadDataset(projectId, file, metadata, options);

const DatasetUploadContext = createContext<DatasetUploadContextValue>({
  adapter: defaultAdapter,
  maxBytes: DATASET_UPLOAD_MAX_BYTES,
});

export function DatasetUploadProvider({
  adapter,
  maxBytes,
  children,
}: {
  adapter?: DatasetUploadAdapter;
  maxBytes?: number;
  children: ReactNode;
}) {
  const value = useMemo<DatasetUploadContextValue>(
    () => ({ adapter: adapter ?? defaultAdapter, maxBytes: maxBytes ?? DATASET_UPLOAD_MAX_BYTES }),
    [adapter, maxBytes],
  );
  return <DatasetUploadContext.Provider value={value}>{children}</DatasetUploadContext.Provider>;
}

/** The active dataset upload transport (OSS default = multipart client; override = injected adapter). */
export function useDatasetUploadAdapter(): DatasetUploadAdapter {
  return useContext(DatasetUploadContext).adapter;
}

/** The UI pre-check upload-size cap (OSS default = DATASET_UPLOAD_MAX_BYTES; a replacement implementation may set per plan). */
export function useDatasetUploadMaxBytes(): number {
  return useContext(DatasetUploadContext).maxBytes;
}

'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { datasetClient, datasetImportClient } from '@proofhound/api-client';
import {
  DATASET_UPLOAD_MAX_BYTES,
  type DatasetImportStatusDto,
  type DatasetUploadMetadataDto,
} from '@proofhound/shared';
import type { DatasetTransferSnapshot } from '../screens/datasets/dataset-transfer-progress';

export type { DatasetTransferSnapshot, DatasetTransferPhase } from '../screens/datasets/dataset-transfer-progress';

export interface DatasetUploadProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

/**
 * Replaces the built-in dataset transfer progress panel. OSS renders its default determinate upload
 * panel; a replacement shell whose upload adapter ingests server-side after the bytes are sent injects
 * its own panel to render the post-upload (`processing`) phase however it wants — e.g. a single combined
 * bar without the per-byte percentage / timing readout.
 */
export type DatasetUploadProgressRenderer = (props: {
  progress: DatasetTransferSnapshot | null;
  className?: string;
}) => ReactNode;

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

/** Project-scoped dataset name availability check (true = free to use). */
export type DatasetNameChecker = (projectId: string, name: string) => Promise<boolean>;

/** Hand a failed upload to the hosting shell's issue reporter. OSS omits it (no report affordance). */
export type DatasetUploadReporter = (error: unknown) => void;

interface DatasetUploadContextValue {
  adapter: DatasetUploadAdapter;
  maxBytes: number;
  nameChecker: DatasetNameChecker;
  reportIssue: DatasetUploadReporter | null;
  progressPanel: DatasetUploadProgressRenderer | null;
}

const defaultAdapter: DatasetUploadAdapter = (projectId, file, metadata, options) =>
  datasetImportClient.uploadDataset(projectId, file, metadata, options);

const defaultNameChecker: DatasetNameChecker = (projectId, name) =>
  datasetClient.checkDatasetNameAvailable(projectId, name);

const DatasetUploadContext = createContext<DatasetUploadContextValue>({
  adapter: defaultAdapter,
  maxBytes: DATASET_UPLOAD_MAX_BYTES,
  nameChecker: defaultNameChecker,
  reportIssue: null,
  progressPanel: null,
});

export function DatasetUploadProvider({
  adapter,
  maxBytes,
  nameChecker,
  onReportIssue,
  progressPanel,
  children,
}: {
  adapter?: DatasetUploadAdapter;
  maxBytes?: number;
  nameChecker?: DatasetNameChecker;
  onReportIssue?: DatasetUploadReporter;
  progressPanel?: DatasetUploadProgressRenderer;
  children: ReactNode;
}) {
  const value = useMemo<DatasetUploadContextValue>(
    () => ({
      adapter: adapter ?? defaultAdapter,
      maxBytes: maxBytes ?? DATASET_UPLOAD_MAX_BYTES,
      nameChecker: nameChecker ?? defaultNameChecker,
      reportIssue: onReportIssue ?? null,
      progressPanel: progressPanel ?? null,
    }),
    [adapter, maxBytes, nameChecker, onReportIssue, progressPanel],
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

/** Project-scoped dataset name availability check used by the upload screen to warn before uploading. */
export function useDatasetNameChecker(): DatasetNameChecker {
  return useContext(DatasetUploadContext).nameChecker;
}

/** The hosting shell's issue reporter for a failed upload, or null when there is no report affordance. */
export function useDatasetUploadReportIssue(): DatasetUploadReporter | null {
  return useContext(DatasetUploadContext).reportIssue;
}

/** Injected progress panel that replaces the built-in one, or null to use the OSS default panel. */
export function useDatasetUploadProgressPanel(): DatasetUploadProgressRenderer | null {
  return useContext(DatasetUploadContext).progressPanel;
}

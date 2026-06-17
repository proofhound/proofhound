import { Inject, Injectable } from '@nestjs/common';
import type { DatasetDeletionImpactDto, DatasetDeletionImpactItemDto } from '@proofhound/shared';
import { DatasetRepository, type DatasetDeletionImpactRow } from './dataset.repository';

export interface DatasetDeletionHookInput {
  projectId: string;
  datasetId: string;
}

export abstract class DatasetDeletionHook {
  abstract prepareDatasetDeletion(input: DatasetDeletionHookInput): Promise<DatasetDeletionImpactDto>;
}

@Injectable()
export class LocalDatasetDeletionHook extends DatasetDeletionHook {
  constructor(@Inject(DatasetRepository) private readonly repo: DatasetRepository) {
    super();
  }

  async prepareDatasetDeletion(input: DatasetDeletionHookInput): Promise<DatasetDeletionImpactDto> {
    const rows = await this.repo.listDeletionImpact(input.projectId, input.datasetId);
    const experiments = rows.experiments.map((row) => this.toDeletionImpactItem(row, 'experiment'));
    const optimizations = rows.optimizations.map((row) => this.toDeletionImpactItem(row, 'optimization'));

    return {
      datasetId: input.datasetId,
      experiments,
      optimizations,
      total: experiments.length + optimizations.length,
    };
  }

  private toDeletionImpactItem(
    row: DatasetDeletionImpactRow,
    kind: DatasetDeletionImpactItemDto['kind'],
  ): DatasetDeletionImpactItemDto {
    return {
      id: row.id,
      kind,
      name: row.name,
      status: row.status,
      datasetId: row.datasetId,
      promptId: row.promptId,
      promptVersionId: row.promptVersionId,
      promptVersionNumber: row.promptVersionNumber,
      createdAt: row.createdAt?.toISOString() ?? null,
    };
  }
}

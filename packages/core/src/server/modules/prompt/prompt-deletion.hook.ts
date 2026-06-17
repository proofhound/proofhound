import { Inject, Injectable } from '@nestjs/common';
import type { PromptDeletionImpactDto, PromptDeletionImpactItemDto } from '@proofhound/shared';
import { PromptRepository, type PromptDeletionImpactRow, type PromptVersionRow } from './prompt.repository';

export interface PromptDeletionHookInput {
  projectId: string;
  promptId: string;
  versions: PromptVersionRow[];
  includePromptShell: boolean;
}

export abstract class PromptDeletionHook {
  abstract preparePromptDeletion(input: PromptDeletionHookInput): Promise<PromptDeletionImpactDto>;
}

@Injectable()
export class LocalPromptDeletionHook extends PromptDeletionHook {
  constructor(@Inject(PromptRepository) private readonly repo: PromptRepository) {
    super();
  }

  async preparePromptDeletion(input: PromptDeletionHookInput): Promise<PromptDeletionImpactDto> {
    const versionIds = input.versions.map((version) => version.id);
    const generatedOptimizationIds = input.versions
      .map((version) => version.generatedByOptimizationId)
      .filter((id): id is string => Boolean(id));
    const rows = await this.repo.listDeletionImpact({
      projectId: input.projectId,
      promptId: input.promptId,
      versionIds,
      generatedOptimizationIds,
      includePromptShell: input.includePromptShell,
    });

    const releaseLines = rows.releaseLines.map((row) => this.toDeletionImpactItem(row, 'release_line'));
    const experiments = rows.experiments.map((row) => this.toDeletionImpactItem(row, 'experiment'));
    const optimizations = rows.optimizations.map((row) => this.toDeletionImpactItem(row, 'optimization'));

    return {
      promptId: input.promptId,
      versionId: input.includePromptShell ? null : (input.versions[0]?.id ?? null),
      releaseLines,
      experiments,
      optimizations,
      total: releaseLines.length + experiments.length + optimizations.length,
    };
  }

  private toDeletionImpactItem(
    row: PromptDeletionImpactRow,
    kind: PromptDeletionImpactItemDto['kind'],
  ): PromptDeletionImpactItemDto {
    return {
      id: row.id,
      kind,
      name: row.name,
      status: row.status,
      promptId: row.promptId,
      promptVersionId: row.promptVersionId,
      promptVersionNumber: row.promptVersionNumber,
      createdAt: row.createdAt?.toISOString() ?? null,
    };
  }
}

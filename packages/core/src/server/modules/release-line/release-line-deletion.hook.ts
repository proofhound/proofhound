import { Inject, Injectable } from '@nestjs/common';
import type { ReleaseLineDeletionImpactDto, ReleaseLineDeletionImpactItemDto } from '@proofhound/shared';
import {
  ReleaseLineRepository,
  type ReleaseLineDeletionImpactRow,
} from './release-line.repository';

export interface ReleaseLineDeletionHookInput {
  projectId: string;
  releaseLineId: string;
}

export abstract class ReleaseLineDeletionHook {
  abstract prepareReleaseLineDeletion(input: ReleaseLineDeletionHookInput): Promise<ReleaseLineDeletionImpactDto | null>;
}

@Injectable()
export class LocalReleaseLineDeletionHook extends ReleaseLineDeletionHook {
  constructor(@Inject(ReleaseLineRepository) private readonly repo: ReleaseLineRepository) {
    super();
  }

  async prepareReleaseLineDeletion(input: ReleaseLineDeletionHookInput): Promise<ReleaseLineDeletionImpactDto | null> {
    const rows = await this.repo.listDeletionImpact(input.projectId, input.releaseLineId);
    if (!rows) return null;
    const events = rows.events.map((row) => this.toDeletionImpactItem(row, 'event'));
    const versions = rows.versions.map((row) => this.toDeletionImpactItem(row, 'version'));
    const annotationTasks = rows.annotationTasks.map((row) => this.toDeletionImpactItem(row, 'annotation_task'));

    return {
      releaseLineId: rows.line.id,
      lineName: rows.line.name,
      events,
      versions,
      annotationTasks,
      runResults: rows.runResults,
      total: events.length + versions.length + annotationTasks.length + rows.runResults,
    };
  }

  private toDeletionImpactItem(
    row: ReleaseLineDeletionImpactRow,
    kind: ReleaseLineDeletionImpactItemDto['kind'],
  ): ReleaseLineDeletionImpactItemDto {
    return {
      id: row.id,
      kind,
      name: row.name,
      status: row.status,
      detail: row.detail,
      createdAt: row.createdAt?.toISOString() ?? null,
    };
  }
}

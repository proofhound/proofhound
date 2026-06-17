import type { AnnotationTaskDto } from '@proofhound/shared';

export type AnnotationTaskFilter = 'all' | 'open' | 'claimed' | 'submitted' | 'completed';
export type AnnotationTaskStatus = AnnotationTaskDto['status'];

export interface AnnotationTaskView {
  id: string;
  releaseLineId: string;
  releaseVersionId: string;
  releaseVersionLabel: string;
  releaseVersionScope: AnnotationTaskDto['releaseVersionScope'];
  scope: AnnotationTaskDto['scope'];
  name: string;
  sourceName: string;
  promptName: string;
  promptVersionLabel: string | null;
  modelName: string | null;
  inputConnectorName: string | null;
  status: AnnotationTaskStatus;
  total: number;
  claimed: number;
  submitted: number;
  pending: number;
  open: number;
  completionRate: number | null;
  qualityScore: number | null;
  updatedAt: string;
  createdAt: string;
  raw: AnnotationTaskDto;
}

export interface AnnotationTaskSummary {
  totalTasks: number;
  activeTasks: number;
  openSamples: number;
  claimedSamples: number;
  submittedSamples: number;
  completionRate: number | null;
}

export function buildAnnotationTasks(tasks: AnnotationTaskDto[]): AnnotationTaskView[] {
  return tasks
    .map((task) => {
      const total = task.progress.total;
      const claimed = task.progress.claimed;
      const submitted = task.progress.submitted;
      const open = Math.max(0, total - submitted);
      const pending = Math.max(0, task.progress.pending);
      return {
        id: task.id,
        releaseLineId: task.releaseLineId,
        releaseVersionId: task.releaseVersionId,
        releaseVersionLabel: task.releaseVersionLabel,
        releaseVersionScope: task.releaseVersionScope,
        scope: task.scope,
        name: task.name,
        sourceName: task.releaseLineName,
        promptName: task.promptName,
        promptVersionLabel: task.promptVersionLabel,
        modelName: task.modelName,
        inputConnectorName: null,
        status: task.status,
        total,
        claimed,
        submitted,
        pending,
        open,
        completionRate: total > 0 ? submitted / total : null,
        qualityScore: task.quality?.score ?? null,
        updatedAt: task.updatedAt,
        createdAt: task.createdAt,
        raw: task,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function summarizeAnnotationTasks(tasks: AnnotationTaskView[]): AnnotationTaskSummary {
  const totals = tasks.reduce(
    (acc, task) => {
      acc.activeTasks += task.status === 'active' ? 1 : 0;
      acc.openSamples += task.open;
      acc.claimedSamples += task.claimed;
      acc.submittedSamples += task.submitted;
      acc.totalSamples += task.total;
      return acc;
    },
    {
      activeTasks: 0,
      openSamples: 0,
      claimedSamples: 0,
      submittedSamples: 0,
      totalSamples: 0,
    },
  );

  return {
    totalTasks: tasks.length,
    activeTasks: totals.activeTasks,
    openSamples: totals.openSamples,
    claimedSamples: totals.claimedSamples,
    submittedSamples: totals.submittedSamples,
    completionRate: totals.totalSamples > 0 ? totals.submittedSamples / totals.totalSamples : null,
  };
}

export function filterAnnotationTasks(
  tasks: AnnotationTaskView[],
  filter: AnnotationTaskFilter,
  search: string,
): AnnotationTaskView[] {
  const query = search.trim().toLowerCase();
  return tasks.filter((task) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'open' && task.open > 0) ||
      (filter === 'claimed' && task.claimed > 0) ||
      (filter === 'submitted' && task.submitted > 0) ||
      (filter === 'completed' && task.status === 'completed');

    if (!matchesFilter) return false;
    if (!query) return true;

    return [
      task.name,
      task.sourceName,
      task.promptName,
      task.promptVersionLabel,
      task.modelName,
      task.releaseVersionLabel,
      task.releaseVersionId,
      task.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

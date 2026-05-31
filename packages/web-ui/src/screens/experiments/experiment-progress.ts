import { formatProgressLabel } from '@proofhound/ui';
import type { TranslationKey } from '../../i18n';

import type { ExperimentSummary } from './experiment-view-model';

export function progressLabel(experiment: ExperimentSummary, percent: number) {
  return formatProgressLabel({
    value: experiment.progressDone,
    max: Math.max(1, experiment.progressTotal),
    percent,
    fractionDigits: 1,
  });
}

export function progressTimingLabel(t: (key: TranslationKey) => string, experiment: ExperimentSummary) {
  return t('common.progress.timing')
    .replace('{elapsed}', experiment.elapsedLabel)
    .replace('{remaining}', experiment.remainingLabel ?? t('common.progress.done'));
}

import { positiveRuntimeLimit } from '../../providers';
import type { ProjectModel } from './model-view-model';

export function applyRuntimeConcurrencyCapToModel(
  model: ProjectModel,
  runtimeConcurrencyCap?: number | null,
): ProjectModel {
  const cap = positiveRuntimeLimit(runtimeConcurrencyCap);
  if (cap === null) return model;

  const modelLimit = parsePositiveInteger(model.concurrency.limit);
  const limitInput = parsePositiveInteger(model.concurrency.limitInput);
  const effective = parsePositiveInteger(model.concurrency.effective);
  const current = parseNonnegativeNumber(model.concurrency.current);
  const cappedLimit = Math.min(modelLimit ?? cap, cap);
  const cappedEffective = effective === null ? undefined : String(Math.min(effective, cappedLimit));

  return {
    ...model,
    concurrency: {
      ...model.concurrency,
      limit: String(cappedLimit),
      limitInput: limitInput === null ? model.concurrency.limitInput : String(Math.min(limitInput, cap)),
      usage: current === null ? model.concurrency.usage : Math.min(100, Math.round((current / cappedLimit) * 100)),
      effective: cappedEffective,
    },
  };
}

export function clampRuntimeConcurrencyInputText(value: string, runtimeConcurrencyCap?: number | null): string {
  const cap = positiveRuntimeLimit(runtimeConcurrencyCap);
  if (cap === null) return value;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= cap) return value;
  return String(cap);
}

export function runtimeConcurrencyCreateDefaultValue(runtimeConcurrencyCap?: number | null): string | undefined {
  const cap = positiveRuntimeLimit(runtimeConcurrencyCap);
  return cap === null ? undefined : String(cap);
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonnegativeNumber(value: string | undefined) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

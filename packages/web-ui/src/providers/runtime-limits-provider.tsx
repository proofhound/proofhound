'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface RuntimeLimitsUiContract {
  concurrency?: {
    max?: number | null;
  };
}

const RuntimeLimitsContext = createContext<RuntimeLimitsUiContract>({});

export function RuntimeLimitsProvider({ children, value }: { children: ReactNode; value?: RuntimeLimitsUiContract }) {
  return <RuntimeLimitsContext.Provider value={value ?? {}}>{children}</RuntimeLimitsContext.Provider>;
}

export function useRuntimeLimits(): RuntimeLimitsUiContract {
  return useContext(RuntimeLimitsContext);
}

export function positiveRuntimeLimit(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

export function resolveEffectiveConcurrencyLimit(
  modelLimit: number | null | undefined,
  runtimeLimits: RuntimeLimitsUiContract,
): number | null {
  const positiveModelLimit = positiveRuntimeLimit(modelLimit);
  const planLimit = positiveRuntimeLimit(runtimeLimits.concurrency?.max);
  if (positiveModelLimit !== null && planLimit !== null) return Math.min(positiveModelLimit, planLimit);
  return positiveModelLimit ?? planLimit;
}

export function capConcurrencyValue(value: number, limit: number | null | undefined): number {
  const positiveLimit = positiveRuntimeLimit(limit);
  const normalized = Number.isInteger(value) && value > 0 ? value : 1;
  return positiveLimit === null ? normalized : Math.min(normalized, positiveLimit);
}

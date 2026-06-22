const DEFAULT_DECISION_FIELD = 'label';
const DEFAULT_EXPECTED_FIELD = 'expected_output';
const DEFAULT_OPERATOR = 'exact_match';

export interface NormalizedJudgmentRule {
  decisionField: string;
  expectedField: string;
  operator: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStringAlias(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function isThresholdComparisonOperator(value: string | undefined): value is 'gt' | 'gte' | 'lt' | 'lte' | 'eq' {
  return value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte' || value === 'eq';
}

function mergeLegacyConfig(source: Record<string, unknown>): Record<string, unknown> {
  const config = isRecord(source['config']) ? source['config'] : null;
  return config ? { ...config, ...source } : source;
}

function readJudgmentOperator(source: Record<string, unknown>): string | undefined {
  const explicitMode = readStringAlias(source, ['mode', 'ruleName']);
  if (explicitMode) return explicitMode;
  const operator = readStringAlias(source, ['operator']);
  if (isThresholdComparisonOperator(operator) && source['threshold'] !== undefined) return 'threshold';
  return operator;
}

function readThresholdOperator(source: Record<string, unknown>): string | undefined {
  const explicit = readStringAlias(source, ['thresholdOperator', 'comparisonOperator']);
  if (explicit) return explicit;
  const operator = readStringAlias(source, ['operator']);
  return isThresholdComparisonOperator(operator) ? operator : undefined;
}

function hasRuleSignal(rule: Record<string, unknown>, root?: NormalizedJudgmentRule): boolean {
  return Boolean(
    readStringAlias(rule, ['decisionField', 'decision_field', 'field']) ??
      readStringAlias(rule, ['expectedField', 'expected_field', 'value']) ??
      readStringAlias(rule, ['operator', 'mode', 'ruleName']) ??
      root?.decisionField ??
      root?.expectedField ??
      root?.operator ??
      rule['threshold'] ??
      rule['description'],
  );
}

function readRootAliases(source: Record<string, unknown>): NormalizedJudgmentRule {
  const merged = mergeLegacyConfig(source);
  return {
    decisionField: readStringAlias(merged, ['decisionField', 'decision_field', 'field']) ?? DEFAULT_DECISION_FIELD,
    expectedField: readStringAlias(merged, ['expectedField', 'expected_field', 'value']) ?? DEFAULT_EXPECTED_FIELD,
    operator: readJudgmentOperator(merged) ?? DEFAULT_OPERATOR,
  };
}

function readExplicitDecisionField(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const merged = mergeLegacyConfig(value);
  const rootValue = readStringAlias(merged, ['decisionField', 'decision_field', 'field']) ?? null;
  const rawRules = Array.isArray(value['rules']) ? value['rules'] : merged['rules'];
  if (Array.isArray(rawRules)) {
    for (const rule of rawRules) {
      if (!isRecord(rule)) continue;
      const ruleMerged = mergeLegacyConfig(rule);
      const ruleValue = readStringAlias(ruleMerged, ['decisionField', 'decision_field', 'field']);
      if (ruleValue) return ruleValue;
      if (rootValue && hasRuleSignal(ruleMerged)) return rootValue;
    }
    return rootValue;
  }

  return rootValue;
}

function normalizeRule(value: unknown, root?: NormalizedJudgmentRule): NormalizedJudgmentRule | null {
  if (!isRecord(value)) return null;
  const merged = mergeLegacyConfig(value);
  if (!hasRuleSignal(merged, root)) return null;

  const thresholdOperator = readThresholdOperator(merged);
  return {
    ...(thresholdOperator ? { thresholdOperator } : {}),
    ...(merged['threshold'] !== undefined ? { threshold: merged['threshold'] } : {}),
    decisionField:
      readStringAlias(merged, ['decisionField', 'decision_field', 'field']) ??
      root?.decisionField ??
      DEFAULT_DECISION_FIELD,
    expectedField:
      readStringAlias(merged, ['expectedField', 'expected_field', 'value']) ??
      root?.expectedField ??
      DEFAULT_EXPECTED_FIELD,
    operator: readJudgmentOperator(merged) ?? root?.operator ?? DEFAULT_OPERATOR,
  };
}

export function normalizeJudgmentRules(value: unknown): { rules: NormalizedJudgmentRule[] } | null {
  if (!isRecord(value)) return null;
  const merged = mergeLegacyConfig(value);
  const root = readRootAliases(value);
  const rawRules = Array.isArray(value['rules']) ? value['rules'] : merged['rules'];
  if (Array.isArray(rawRules)) {
    const rules = rawRules
      .map((rule) => normalizeRule(rule, root))
      .filter((rule): rule is NormalizedJudgmentRule => Boolean(rule));
    if (rules.length > 0) return { rules };
  }
  const direct = normalizeRule(value);
  return { rules: direct ? [direct] : [] };
}

export function readJudgmentDecisionField(rules: unknown, fallback = DEFAULT_DECISION_FIELD): string {
  return readExplicitDecisionField(rules) ?? fallback;
}

export function readJudgmentMode(rules: unknown): string {
  return normalizeJudgmentRules(rules)?.rules[0]?.operator ?? DEFAULT_OPERATOR;
}

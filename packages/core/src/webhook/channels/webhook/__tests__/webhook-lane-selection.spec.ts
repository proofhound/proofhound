import { describe, expect, it } from 'vitest';
import type { WebhookReleaseRuntimeLineRow, WebhookReleaseRuntimeRow } from '../webhook.repository';
import { selectWebhookLanes } from '../webhook.service';

// selectWebhookLanes is the request-time router that decides which lane(s) a webhook request hits once
// a canary candidate carries a traffic ratio + mode. Webhook canaries (first-time and added onto a
// production) now configure both, so these branches must hold. trafficRatio 1 always hits and 0 never
// hits, so the cases below are deterministic without depending on the stable-hash bucket.
function makeLane(overrides: Partial<WebhookReleaseRuntimeRow>): WebhookReleaseRuntimeRow {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    releaseLineId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    laneType: 'production',
    promptName: 'p',
    promptVersionId: '33333333-3333-4333-8333-333333333333',
    promptId: '44444444-4444-4444-8444-444444444444',
    modelId: '55555555-5555-4555-8555-555555555555',
    inputConnectorId: '66666666-6666-4666-8666-666666666666',
    trafficRatio: null,
    trafficMode: null,
    variableMapping: [],
    filterRules: null,
    externalIdField: 'id',
    runConfig: {},
    promptBody: 'Classify {{text}}',
    promptVariables: [],
    promptOutputSchema: { fields: [] },
    promptJudgmentRules: null,
    promptLanguage: 'en-US',
    ...overrides,
  };
}

const production = makeLane({ id: 'prod-1', laneType: 'production' });
const payload = { id: 'sample-1', text: 'hello' };

function line(over: Partial<WebhookReleaseRuntimeLineRow>): WebhookReleaseRuntimeLineRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    production: null,
    canary: null,
    ...over,
  };
}

describe('selectWebhookLanes', () => {
  it('routes to production only when there is no canary', () => {
    const lanes = selectWebhookLanes(line({ production }), payload);
    expect(lanes).toEqual([{ lane: production, canonical: true }]);
  });

  it('returns nothing when there is neither production nor canary', () => {
    expect(selectWebhookLanes(line({}), payload)).toEqual([]);
  });

  // First-time webhook canary (no production lane): a hit goes to the candidate, a miss produces no output.
  it('first-time canary hit routes to the candidate as canonical', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 1, trafficMode: 'split' });
    expect(selectWebhookLanes(line({ canary }), payload)).toEqual([{ lane: canary, canonical: true }]);
  });

  it('first-time canary miss produces no lane', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 0, trafficMode: 'split' });
    expect(selectWebhookLanes(line({ canary }), payload)).toEqual([]);
  });

  // Split canary on a production: hits take over, misses fall back to production.
  it('split canary hit replaces production for that request', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 1, trafficMode: 'split' });
    expect(selectWebhookLanes(line({ production, canary }), payload)).toEqual([
      { lane: canary, canonical: true },
    ]);
  });

  it('split canary miss keeps production canonical', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 0, trafficMode: 'split' });
    expect(selectWebhookLanes(line({ production, canary }), payload)).toEqual([
      { lane: production, canonical: true },
    ]);
  });

  // Dual-run canary mirrors: production always canonical, candidate only mirrors on a hit.
  it('dual-run canary hit mirrors alongside the canonical production', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 1, trafficMode: 'dual_run' });
    expect(selectWebhookLanes(line({ production, canary }), payload)).toEqual([
      { lane: production, canonical: true },
      { lane: canary, canonical: false },
    ]);
  });

  it('dual-run canary miss only runs production', () => {
    const canary = makeLane({ id: 'canary-1', laneType: 'canary', trafficRatio: 0, trafficMode: 'dual_run' });
    expect(selectWebhookLanes(line({ production, canary }), payload)).toEqual([
      { lane: production, canonical: true },
    ]);
  });
});

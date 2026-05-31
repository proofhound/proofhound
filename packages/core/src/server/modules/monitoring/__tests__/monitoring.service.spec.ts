import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { MonitoringService } from '../monitoring.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR: CurrentUserPayload = {
  sub: '00000000-0000-4000-8000-000000000001',
  actorKind: 'local_user',
  email: 'local-admin@proofhound.local',
  isActive: true,
  isSuperAdmin: true,
};

const emptyBySource = { prod: 0, canary: 0, iter: 0, exp: 0 };
const emptyStats = {
  requests: { total: 0, previous: 0, bySource: emptyBySource },
  errors: { total: 0, previous: 0, bySource: emptyBySource },
  rpmPeak: { total: 0, previous: 0, bySource: emptyBySource },
  tpmPeak: { total: 0, previous: 0, bySource: emptyBySource },
  latencyAverageMs: { total: 0, previous: 0, bySource: emptyBySource },
  latencyP50Ms: { total: 0, previous: 0, bySource: emptyBySource },
  latencyP95Ms: { total: 0, previous: 0, bySource: emptyBySource },
  latencyP99Ms: { total: 0, previous: 0, bySource: emptyBySource },
  tokens: { total: 0, previous: 0, bySource: emptyBySource },
  cost: { total: 0, previous: 0, bySource: emptyBySource },
};

describe('MonitoringService', () => {
  it('normalizes the filter and delegates stats reads through project access control', async () => {
    const repo = {
      getStats: vi.fn().mockResolvedValue(emptyStats),
    };
    const service = new MonitoringService(repo as never, new LocalAccessControlService());

    await expect(
      service.getStats(
        PROJECT_ID,
        {
          from: '2026-05-23T00:00:00.000Z',
          to: '2026-05-23T01:00:00.000Z',
          granularity: 'auto',
          sources: ['prod', 'exp'],
        },
        ACTOR,
      ),
    ).resolves.toEqual(emptyStats);

    expect(repo.getStats).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        from: '2026-05-23T00:00:00.000Z',
        to: '2026-05-23T01:00:00.000Z',
        granularity: 'auto',
        sources: ['prod', 'exp'],
      }),
    );
  });

  it('rejects an empty or reversed monitoring time range before querying', async () => {
    const repo = {
      getStats: vi.fn(),
    };
    const service = new MonitoringService(repo as never, new LocalAccessControlService());

    await expect(
      service.getStats(
        PROJECT_ID,
        {
          from: '2026-05-23T01:00:00.000Z',
          to: '2026-05-23T01:00:00.000Z',
          granularity: 'auto',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.getStats).not.toHaveBeenCalled();
  });
});

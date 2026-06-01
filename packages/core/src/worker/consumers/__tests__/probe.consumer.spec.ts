import { probeJobPayloadSchema } from '@proofhound/orchestration-shared';

describe('probe.consumer payload contract', () => {
  it('accepts a probe payload with only modelId', () => {
    const result = probeJobPayloadSchema.safeParse({
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid modelId', () => {
    const result = probeJobPayloadSchema.safeParse({ modelId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

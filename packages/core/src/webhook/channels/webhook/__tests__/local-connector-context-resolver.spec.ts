import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { WebhookRepository } from '../webhook.repository';
import { LocalConnectorContextResolver } from '../local-connector-context.resolver';

const TOKEN = 'wh_secret_token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const connector = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '11111111-1111-4111-8111-111111111111',
  name: 'inbound',
  config: {},
  webhookPath: null,
  ipWhitelist: null,
};
const tokenId = '33333333-3333-4333-8333-333333333333';

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findConnectorWithValidToken: vi.fn().mockResolvedValue({ connector, tokenId, tokenExpiresAt: null }),
    touchTokenLastUsed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WebhookRepository;
}

describe('LocalConnectorContextResolver', () => {
  it('resolves a valid token into connector + project + system_webhook actor + tokenId', async () => {
    const repo = makeRepo();
    const resolver = new LocalConnectorContextResolver(repo);

    const result = await resolver.resolveFromWebhookToken('  WH-ABC  ', '/foo/bar/', TOKEN);

    // normalizes slug (trim+lowercase) and path (trim segments) before the lookup
    expect(repo.findConnectorWithValidToken).toHaveBeenCalledWith('wh-abc', 'foo/bar', TOKEN_HASH);
    expect(repo.touchTokenLastUsed).toHaveBeenCalledWith(tokenId);
    expect(result).toEqual({
      connector,
      projectContext: { projectId: connector.projectId, source: 'local' },
      actorContext: { actorId: connector.id, actorKind: 'system_webhook' },
      webhookTokenId: tokenId,
    });
  });

  it('throws invalid_webhook_token when no row matches', async () => {
    const repo = makeRepo({ findConnectorWithValidToken: vi.fn().mockResolvedValue(null) });
    const resolver = new LocalConnectorContextResolver(repo);
    await expect(resolver.resolveFromWebhookToken('wh-abc', '', TOKEN)).rejects.toMatchObject({
      message: 'invalid_webhook_token',
    });
  });

  it('throws expired_webhook_token when the matched token is past expiry (distinct from invalid)', async () => {
    const repo = makeRepo({
      findConnectorWithValidToken: vi
        .fn()
        .mockResolvedValue({ connector, tokenId, tokenExpiresAt: new Date(Date.now() - 1000) }),
      touchTokenLastUsed: vi.fn(),
    });
    const resolver = new LocalConnectorContextResolver(repo);
    await expect(resolver.resolveFromWebhookToken('wh-abc', '', TOKEN)).rejects.toMatchObject({
      message: 'expired_webhook_token',
    });
    expect(repo.touchTokenLastUsed).not.toHaveBeenCalled();
  });
});

// LocalConnectorContextResolver — OSS default for ConnectorContextResolver (§3.4)
// See docs/specs/08-adapter-extension-points.md §3.4 and docs/specs/09-mcp-server.md is unrelated.
//
// Extracted from the previously-inline WebhookService.authorizeConnector. Validates inbound webhook
// credentials and produces { connector, projectContext, actorContext, webhookTokenId } in one shot —
// the webhook entry does NOT go through ProjectContextResolver (§3.1).
//
// Lives in the webhook runtime because it depends on WebhookRepository. The abstract
// ConnectorContextResolver lives in server/common/contracts (the shared adapter seam); importing it
// here is acyclic (the abstract never imports the webhook runtime).
//
// expired-vs-invalid distinction: the repo query deliberately omits the `expires_at > now()` filter so
// a missing row → `invalid_webhook_token`, while a present-but-expired row → `expired_webhook_token`.

import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ConnectorContextResolver,
  type ConnectorResolveResult,
} from '../../../server/common/contracts/connector-context.resolver';
import { WebhookRepository } from './webhook.repository';
import { normalizePathName, normalizeSlug } from './webhook-token.util';

@Injectable()
export class LocalConnectorContextResolver extends ConnectorContextResolver {
  constructor(@Inject(WebhookRepository) private readonly repo: WebhookRepository) {
    super();
  }

  async resolveFromWebhookToken(
    webhookSlug: string,
    pathName: string,
    token: string,
  ): Promise<ConnectorResolveResult> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.repo.findConnectorWithValidToken(
      normalizeSlug(webhookSlug),
      normalizePathName(pathName),
      tokenHash,
    );
    if (!result) throw new UnauthorizedException('invalid_webhook_token');

    const expiresAt = result.tokenExpiresAt ? new Date(result.tokenExpiresAt).getTime() : null;
    if (expiresAt !== null && expiresAt <= Date.now()) {
      throw new UnauthorizedException('expired_webhook_token');
    }
    await this.repo.touchTokenLastUsed(result.tokenId);

    return {
      connector: result.connector,
      projectContext: { projectId: result.connector.projectId, source: 'local' },
      actorContext: { actorId: result.connector.id, actorKind: 'system_webhook' },
      webhookTokenId: result.tokenId,
    };
  }
}

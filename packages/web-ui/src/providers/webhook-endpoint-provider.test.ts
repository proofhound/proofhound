import { describe, expect, it } from 'vitest';
import { buildWebhookUrl } from './webhook-endpoint-provider';

describe('buildWebhookUrl', () => {
  it('uses the injected deployment webhook origin', () => {
    expect(buildWebhookUrl('https://webhook-staging-ee3f.up.railway.app/', '/webhooks/acme/run')).toBe(
      'https://webhook-staging-ee3f.up.railway.app/webhooks/acme/run',
    );
  });

  it('falls back to the shell placeholder when no webhook origin is injected', () => {
    expect(buildWebhookUrl(undefined, '/webhooks/acme/run')).toBe('$PROOFHOUND_API_ORIGIN/webhooks/acme/run');
  });
});

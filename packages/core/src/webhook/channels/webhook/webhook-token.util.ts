// Shared webhook inbound-credential helpers.
// Extracted from webhook.service.ts so both the service (bearer parsing at the call site) and
// LocalConnectorContextResolver (slug / path normalization) can use them without a circular import.

import { UnauthorizedException } from '@nestjs/common';

export function parseBearerToken(header: string | null): string {
  const match = /^Bearer\s+(.+)$/iu.exec(header ?? '');
  if (!match?.[1]) throw new UnauthorizedException('missing_api_token');
  return match[1].trim();
}

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePathName(value: string): string {
  return value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

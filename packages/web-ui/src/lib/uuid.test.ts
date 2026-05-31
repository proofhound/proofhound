import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import { isCanonicalUuid } from './uuid';

describe('isCanonicalUuid', () => {
  it('accepts the local project id used by the self-hosted workspace', () => {
    expect(isCanonicalUuid(LOCAL_PROJECT_ID)).toBe(true);
  });

  it('accepts RFC versioned UUIDs generated for resources', () => {
    expect(isCanonicalUuid('db945aa9-fe6e-4591-9b99-42f0b4dd567e')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isCanonicalUuid('db945aa9-fe6e-4591-9b99')).toBe(false);
    expect(isCanonicalUuid('not-a-uuid')).toBe(false);
  });
});

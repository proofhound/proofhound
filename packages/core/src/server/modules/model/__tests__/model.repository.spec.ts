import type { DbClient } from '@proofhound/db';
import { ModelRepository } from '../model.repository';

const mockDb = {} as DbClient;

describe('ModelRepository (DB stub smoke tests)', () => {
  it('can be instantiated without throwing', () => {
    expect(() => new ModelRepository(mockDb)).not.toThrow();
  });

  it('exposes the expected public methods', () => {
    const repo = new ModelRepository(mockDb);
    const methods = ['findContextWindows', 'findContextWindowByProviderModelId', 'upsertContextWindow'];

    for (const method of methods) {
      expect(typeof (repo as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

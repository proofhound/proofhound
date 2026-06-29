import { describe, expect, it } from 'vitest';
import type { DbClient } from '@proofhound/db';
import { DatasetImportRepository } from '../dataset-import.repository';

const mockDb = {} as DbClient;

describe('DatasetImportRepository (DB stub smoke tests)', () => {
  it('can be instantiated without throwing', () => {
    expect(() => new DatasetImportRepository(mockDb)).not.toThrow();
  });

  it('exposes the expected public methods', () => {
    const repo = new DatasetImportRepository(mockDb);
    const methods = [
      'createImport',
      'appendBatch',
      'promote',
      'markPromoting',
      'markAborted',
      'clearStaging',
      'findImportById',
      'markFailed',
    ];

    for (const method of methods) {
      expect(typeof (repo as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

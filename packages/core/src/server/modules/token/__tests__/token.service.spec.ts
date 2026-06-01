import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi, type Mocked } from 'vitest';
import { CryptoService } from '../../../../shared/crypto/crypto.service';
import { TokenRepository, type UserTokenRow } from '../token.repository';
import { TokenService } from '../token.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';

const PM = { sub: 'pm-1', email: 'p@p.com', isSuperAdmin: false, isActive: true };
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

function fakeRow(overrides: Partial<UserTokenRow> = {}): UserTokenRow {
  return {
    id: TOKEN_ID,
    scope: 'user',
    projectId: null,
    connectorId: null,
    name: 'local-script',
    tokenHash: 'hash',
    tokenEncrypted: 'enc:ph_tok_plaintext',
    prefix: 'ph_tok_abcde',
    ipWhitelist: null,
    lastUsedAt: null,
    expiresAt: null,
    createdBy: PM.sub,
    createdAt: new Date('2026-05-20T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let repo: Mocked<TokenRepository>;
  let crypto: Mocked<CryptoService>;

  beforeEach(async () => {
    repo = {
      listUserTokens: vi.fn().mockResolvedValue([{ ...fakeRow(), createdByDisplayName: 'Local User' }]),
      findUserTokenById: vi.fn().mockResolvedValue({ ...fakeRow(), createdByDisplayName: 'Local User' }),
      findUserTokenByName: vi.fn().mockResolvedValue(null),
      insertUserToken: vi.fn().mockImplementation((values) => Promise.resolve(fakeRow(values))),
      updateUserToken: vi.fn().mockImplementation((_tokenId, values) =>
        Promise.resolve({
          ...fakeRow(values),
          createdByDisplayName: 'Local User',
        }),
      ),
      revokeUserToken: vi.fn().mockResolvedValue(true),
    } as unknown as Mocked<TokenRepository>;
    crypto = {
      encryptApiKey: vi.fn((plain: string) => `enc:${plain}`),
      decryptApiKey: vi.fn((cipher: string) => cipher.replace(/^enc:/, '')),
    } as unknown as Mocked<CryptoService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: TokenRepository, useValue: repo },
        { provide: CryptoService, useValue: crypto },
        { provide: AccessControlService, useClass: LocalAccessControlService },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  it('lists user tokens without plaintext', async () => {
    const result = await service.listUserTokens(PM);
    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ prefix: 'ph_tok_abcde' }));
    expect(result.data[0]?.createdByDisplayName).toBe('Local User');
    expect(result.data[0]).not.toHaveProperty('plaintext');
  });

  it('rejects duplicate active names across all user tokens (no project boundary)', async () => {
    repo.findUserTokenByName.mockResolvedValueOnce(fakeRow());
    await expect(service.createUserToken({ name: 'local-script' }, PM)).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a hashed and encrypted user token without project_id and returns plaintext', async () => {
    const result = await service.createUserToken({ name: 'local-script' }, PM);
    expect(result.plaintext).toMatch(/^ph_tok_/);
    expect(result.token.createdByDisplayName).toBe('Local User');
    expect(repo.insertUserToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        projectId: null,
        name: 'local-script',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tokenEncrypted: expect.stringMatching(/^enc:ph_tok_/),
        prefix: expect.stringMatching(/^ph_tok_/),
      }),
    );
  });

  it('reveals encrypted user token plaintext', async () => {
    const result = await service.revealUserToken(TOKEN_ID, PM);
    expect(result).toEqual({
      tokenId: TOKEN_ID,
      plaintext: 'ph_tok_plaintext',
      available: true,
    });
    expect(crypto.decryptApiKey).toHaveBeenCalledWith('enc:ph_tok_plaintext');
  });

  it('updates user token name and expiration without changing plaintext fields', async () => {
    const result = await service.updateUserToken(
      TOKEN_ID,
      { name: 'local-script-prod', expiresAt: '2026-06-01T00:00:00.000Z' },
      PM,
    );
    expect(result.token).toEqual(expect.objectContaining({ name: 'local-script-prod' }));
    expect(repo.updateUserToken).toHaveBeenCalledWith(TOKEN_ID, {
      name: 'local-script-prod',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('rejects updating user token to a duplicate active name', async () => {
    repo.findUserTokenByName.mockResolvedValueOnce(fakeRow({ id: 'dddddddd-dddd-4ddd-8ddd-000000000001' }));
    await expect(
      service.updateUserToken(TOKEN_ID, { name: 'taken-token' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns unavailable when revealing a legacy hash-only token', async () => {
    repo.findUserTokenById.mockResolvedValueOnce({
      ...fakeRow({ tokenEncrypted: null }),
      createdByDisplayName: 'Local User',
    });
    const result = await service.revealUserToken(TOKEN_ID, PM);
    expect(result.available).toBe(false);
    expect(result.plaintext).toBeNull();
  });

  it('deletes user token by revoking it', async () => {
    const result = await service.deleteUserToken(TOKEN_ID, PM);
    expect(result).toEqual({ tokenId: TOKEN_ID });
    expect(repo.revokeUserToken).toHaveBeenCalledWith(TOKEN_ID, expect.any(Date));
  });
});

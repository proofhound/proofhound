import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateUserTokenDto,
  CreateUserTokenResponseDto,
  DeleteUserTokenResponseDto,
  ListUserTokensResponseDto,
  RevealUserTokenResponseDto,
  UpdateUserTokenDto,
  UpdateUserTokenResponseDto,
  UserTokenSummaryDto,
} from '@proofhound/shared';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../../shared/crypto/crypto.service';
import { TokenRepository, type UserTokenRow, type UserTokenRowWithCreator } from './token.repository';

type ActionSource = 'api' | 'mcp';

// User token = the single local-admin-console user credential; the same token can be used for both the HTTP API and MCP.
// OSS does not bind project_id; the SaaS form may attach project later, but this service does not write it.
// Rows with scope='webhook' are not handled by this service.
// See docs/specs/06-database-schema.md §3.2.
@Injectable()
export class TokenService {
  constructor(
    private readonly repo: TokenRepository,
    private readonly crypto: CryptoService,
    private readonly accessControl: AccessControlService,
  ) {}

  async listUserTokens(actor: CurrentUserPayload): Promise<ListUserTokensResponseDto> {
    await this.accessControl.assertCan(
      toActorContext(actor),
      actor.projectId ? { projectId: actor.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      'user_token_manage',
    );
    const rows = await this.repo.listUserTokens();
    return { data: rows.map((row) => this.toSummary(row)), total: rows.length };
  }

  async createUserToken(
    dto: CreateUserTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<CreateUserTokenResponseDto> {
    await this.accessControl.assertCan(
      toActorContext(actor),
      actor.projectId ? { projectId: actor.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      'user_token_manage',
    );
    const existing = await this.repo.findUserTokenByName(dto.name);
    if (existing) throw new ConflictException(`user_token_name_in_use:${dto.name}`);

    const plaintext = this.generatePlaintext();
    const tokenHash = this.hashToken(plaintext);
    const prefix = plaintext.slice(0, 12);
    const row = await this.repo.insertUserToken({
      scope: 'user',
      projectId: null,
      name: dto.name,
      tokenHash,
      tokenEncrypted: this.crypto.encryptApiKey(plaintext),
      prefix,
      ipWhitelist: dto.ipWhitelist ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.sub,
    });

    const rowWithCreator = await this.repo.findUserTokenById(row.id);
    return { token: this.toSummary(rowWithCreator ?? row), plaintext };
  }

  async updateUserToken(
    tokenId: string,
    dto: UpdateUserTokenDto,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<UpdateUserTokenResponseDto> {
    await this.accessControl.assertCan(
      toActorContext(actor),
      actor.projectId ? { projectId: actor.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      'user_token_manage',
    );
    const row = await this.repo.findUserTokenById(tokenId);
    if (!row) throw new NotFoundException(`user token ${tokenId} not found`);

    if (dto.name !== row.name) {
      const existing = await this.repo.findUserTokenByName(dto.name);
      if (existing && existing.id !== tokenId) throw new ConflictException(`user_token_name_in_use:${dto.name}`);
    }

    const updated = await this.repo.updateUserToken(tokenId, {
      name: dto.name,
      expiresAt: dto.expiresAt === undefined ? row.expiresAt : dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    if (!updated) throw new NotFoundException(`user token ${tokenId} not found`);
    return { token: this.toSummary(updated) };
  }

  async revealUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<RevealUserTokenResponseDto> {
    await this.accessControl.assertCan(
      toActorContext(actor),
      actor.projectId ? { projectId: actor.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      'user_token_manage',
    );
    const row = await this.repo.findUserTokenById(tokenId);
    if (!row) throw new NotFoundException(`user token ${tokenId} not found`);

    const plaintext = row.tokenEncrypted ? this.crypto.decryptApiKey(row.tokenEncrypted) : null;
    return { tokenId, plaintext, available: Boolean(plaintext) };
  }

  async deleteUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    _source: ActionSource = 'api',
  ): Promise<DeleteUserTokenResponseDto> {
    await this.accessControl.assertCan(
      toActorContext(actor),
      actor.projectId ? { projectId: actor.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      'user_token_manage',
    );
    const row = await this.repo.findUserTokenById(tokenId);
    if (!row) throw new NotFoundException(`user token ${tokenId} not found`);

    const revoked = await this.repo.revokeUserToken(tokenId, new Date());
    if (!revoked) throw new NotFoundException(`user token ${tokenId} not found`);
    return { tokenId };
  }

  private generatePlaintext(): string {
    return `ph_tok_${randomBytes(24).toString('base64url')}`;
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private toSummary(row: UserTokenRow | UserTokenRowWithCreator): UserTokenSummaryDto {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      ipWhitelist: (row.ipWhitelist as string[] | null) ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdByDisplayName: 'createdByDisplayName' in row ? row.createdByDisplayName : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

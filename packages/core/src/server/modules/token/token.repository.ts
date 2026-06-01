import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const { tokens } = schema;

export type UserTokenRow = typeof tokens.$inferSelect;
export type UserTokenInsertRow = typeof tokens.$inferInsert;

export interface UserTokenRowWithCreator extends UserTokenRow {
  createdByDisplayName: string | null;
}

// The repository only handles rows where scope='user'. Webhook rows are self-managed by ConnectorRepository; this repo does not read or write them.
// See docs/specs/06-database-schema.md §3.2 / docs/specs/08-saas-adapter-boundary.md §3.5.
@Injectable()
export class TokenRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private readonly selectFields = {
    id: tokens.id,
    scope: tokens.scope,
    projectId: tokens.projectId,
    connectorId: tokens.connectorId,
    name: tokens.name,
    tokenHash: tokens.tokenHash,
    tokenEncrypted: tokens.tokenEncrypted,
    prefix: tokens.prefix,
    ipWhitelist: tokens.ipWhitelist,
    lastUsedAt: tokens.lastUsedAt,
    expiresAt: tokens.expiresAt,
    createdBy: tokens.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdAt: tokens.createdAt,
    revokedAt: tokens.revokedAt,
  } as const;

  async listUserTokens(): Promise<UserTokenRowWithCreator[]> {
    return this.db
      .select(this.selectFields)
      .from(tokens)
      .where(and(eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .orderBy(desc(tokens.createdAt));
  }

  async findUserTokenById(tokenId: string): Promise<UserTokenRowWithCreator | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(tokens)
      .where(and(eq(tokens.id, tokenId), eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserTokenByName(name: string): Promise<UserTokenRow | null> {
    const rows = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.scope, 'user'), eq(tokens.name, name), isNull(tokens.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertUserToken(values: UserTokenInsertRow): Promise<UserTokenRow> {
    const result = await this.db.insert(tokens).values(values).returning();
    const row = result[0];
    if (!row) throw new Error('user token insert returned no row');
    return row;
  }

  async updateUserToken(
    tokenId: string,
    values: Pick<UserTokenInsertRow, 'name' | 'expiresAt'>,
  ): Promise<UserTokenRowWithCreator | null> {
    const result = await this.db
      .update(tokens)
      .set(values)
      .where(and(eq(tokens.id, tokenId), eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .returning(this.selectFields);
    return result[0] ?? null;
  }

  async revokeUserToken(tokenId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.db
      .update(tokens)
      .set({ revokedAt })
      .where(and(eq(tokens.id, tokenId), eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .returning({ id: tokens.id });
    return result.length > 0;
  }
}

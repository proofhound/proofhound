import { z } from 'zod';

// Single user-facing token model: the same token can be used for both HTTP API and MCP.
// See docs/specs/06-database-schema.md §3.2 / docs/specs/08-adapter-extension-points.md §3.5.
//
// Webhook tokens (per-connector) are not handled in this file; they are self-managed by the connector DTO and service.

const tokenNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\w一-龥][\w一-龥 -]{0,79}$/u, {
    message: 'name must start with letter/digit/underscore/CJK; allow spaces and hyphens; 2-80 chars',
  });

const ipWhitelistEntrySchema = z
  .string()
  .trim()
  .min(7)
  .max(64)
  .regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/u, {
    message: 'ip whitelist entry must be IPv4 or IPv4/CIDR',
  });

export const userTokenSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  ipWhitelist: z.array(z.string()).nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type UserTokenSummaryDto = z.infer<typeof userTokenSummarySchema>;

export const listUserTokensResponseSchema = z.object({
  data: z.array(userTokenSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListUserTokensResponseDto = z.infer<typeof listUserTokensResponseSchema>;

export const createUserTokenSchema = z.object({
  name: tokenNameSchema,
  ipWhitelist: z.array(ipWhitelistEntrySchema).max(64).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateUserTokenDto = z.infer<typeof createUserTokenSchema>;

export const createUserTokenResponseSchema = z.object({
  token: userTokenSummarySchema,
  plaintext: z.string(),
});
export type CreateUserTokenResponseDto = z.infer<typeof createUserTokenResponseSchema>;

export const updateUserTokenSchema = z.object({
  name: tokenNameSchema,
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateUserTokenDto = z.infer<typeof updateUserTokenSchema>;

export const updateUserTokenResponseSchema = z.object({
  token: userTokenSummarySchema,
});
export type UpdateUserTokenResponseDto = z.infer<typeof updateUserTokenResponseSchema>;

export const revealUserTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
  plaintext: z.string().nullable(),
  available: z.boolean(),
});
export type RevealUserTokenResponseDto = z.infer<typeof revealUserTokenResponseSchema>;

export const deleteUserTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
});
export type DeleteUserTokenResponseDto = z.infer<typeof deleteUserTokenResponseSchema>;

export const tokenIdParamSchema = z.string().uuid();

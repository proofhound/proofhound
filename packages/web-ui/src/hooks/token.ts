// Frontend user token hooks.
// The backend has only one user token resource (the same token is used for HTTP API, MCP channel, and webhook inbound auth simultaneously);
// the Settings page uses a single token list UI.
import { tokenClient } from '@proofhound/api-client';
import type { CreateUserTokenDto, UpdateUserTokenDto } from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const tokensKey = ['tokens'] as const;

export function useTokens() {
  return useQuery({
    queryKey: tokensKey,
    queryFn: () => tokenClient.listTokens(),
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTokenDto) => tokenClient.createToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useRevealToken() {
  return useMutation({
    mutationFn: (tokenId: string) => tokenClient.revealToken(tokenId),
  });
}

export function useUpdateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, body }: { tokenId: string; body: UpdateUserTokenDto }) =>
      tokenClient.updateToken(tokenId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokenClient.deleteToken(tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

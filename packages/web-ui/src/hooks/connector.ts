import {
  connectorClient,
  type ConnectorDeleteOptions,
} from '@proofhound/api-client';
import type {
  BulkDeleteConnectorsRequestDto,
  ConnectorDetailDto,
  ConnectorListQueryDto,
  ConnectorListResponseDto,
  CreateConnectorDto,
  CreateWebhookTokenDto,
  PeekConnectorRequestDto,
  PeekConnectorResponseDto,
  UpdateConnectorDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const listKey = (projectId: string, query?: ConnectorListQueryDto) =>
  [
    'connectors',
    projectId,
    query?.direction ?? 'all',
    query?.type ?? 'all',
    query?.healthStatus ?? 'all',
    query?.search ?? '',
  ] as const;

const detailKey = (projectId: string, connectorId: string) =>
  ['connectors', projectId, connectorId] as const;

const referencesKey = (projectId: string, connectorId: string) =>
  ['connector-refs', projectId, connectorId] as const;

const webhookTokensKey = (projectId: string, connectorId: string) =>
  ['connector-webhook-tokens', projectId, connectorId] as const;

export function useConnectors(projectId: string, query?: ConnectorListQueryDto) {
  return useQuery({
    queryKey: listKey(projectId, query),
    queryFn: () => connectorClient.list(projectId, query),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useConnector(projectId: string, connectorId: string) {
  return useQuery({
    queryKey: detailKey(projectId, connectorId),
    queryFn: () => connectorClient.get(projectId, connectorId),
    enabled: projectId.length > 0 && connectorId.length > 0,
  });
}

export function useConnectorReferences(projectId: string, connectorId: string, enabled = true) {
  return useQuery({
    queryKey: referencesKey(projectId, connectorId),
    queryFn: () => connectorClient.getReferences(projectId, connectorId),
    enabled: enabled && projectId.length > 0 && connectorId.length > 0,
  });
}

export function useCreateConnector(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnectorDto) => connectorClient.create(projectId, body),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false });
      qc.setQueryData(detailKey(projectId, created.id), created);
    },
  });
}

export function useUpdateConnector(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectorId, body }: { connectorId: string; body: UpdateConnectorDto }) =>
      connectorClient.update(projectId, connectorId, body),
    onSuccess: (updated, { connectorId }) => {
      void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false });
      qc.setQueryData(detailKey(projectId, connectorId), updated);
    },
  });
}

export function useDeleteConnector(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectorId, options }: { connectorId: string; options?: ConnectorDeleteOptions }) =>
      connectorClient.delete(projectId, connectorId, options),
    onSuccess: (_data, { connectorId }) => {
      void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false });
      void qc.removeQueries({ queryKey: detailKey(projectId, connectorId) });
    },
  });
}

export function useBulkDeleteConnectors(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkDeleteConnectorsRequestDto) => connectorClient.bulkDelete(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false }),
  });
}

export function useProbeConnector(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectorId: string) => connectorClient.probe(projectId, connectorId),
    onSuccess: (_data, connectorId) => {
      void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false });
      void qc.invalidateQueries({ queryKey: detailKey(projectId, connectorId) });
    },
  });
}

export function usePeekConnector(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectorId, body }: { connectorId: string; body?: PeekConnectorRequestDto }) =>
      connectorClient.peek(projectId, connectorId, body ?? { limit: 5 }),
    onSuccess: (data, { connectorId }) => {
      qc.setQueryData<ConnectorDetailDto | undefined>(detailKey(projectId, connectorId), (current) =>
        current ? applyPeekResultToConnector(current, data) : current,
      );
      qc.setQueriesData<ConnectorListResponseDto>(
        { queryKey: ['connectors', projectId], exact: false },
        (current) =>
          current && Array.isArray(current.data)
            ? {
                ...current,
                data: current.data.map((item) =>
                  item.id === connectorId ? applyPeekResultToConnector(item, data) : item,
                ),
              }
            : current,
      );
      void qc.invalidateQueries({ queryKey: ['connectors', projectId], exact: false });
      void qc.invalidateQueries({ queryKey: detailKey(projectId, connectorId) });
    },
  });
}

// per-connector webhook tokens hooks
// See packages/api-client/src/connector.ts + docs/specs/26-connectors.md
export function useConnectorWebhookTokens(projectId: string, connectorId: string, enabled = true) {
  return useQuery({
    queryKey: webhookTokensKey(projectId, connectorId),
    queryFn: () => connectorClient.listWebhookTokens(projectId, connectorId),
    enabled: enabled && projectId.length > 0 && connectorId.length > 0,
  });
}

export function useCreateConnectorWebhookToken(projectId: string, connectorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebhookTokenDto) =>
      connectorClient.createWebhookToken(projectId, connectorId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookTokensKey(projectId, connectorId) });
      void qc.invalidateQueries({ queryKey: detailKey(projectId, connectorId) });
    },
  });
}

export function useRevokeConnectorWebhookToken(projectId: string, connectorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => connectorClient.revokeWebhookToken(projectId, connectorId, tokenId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookTokensKey(projectId, connectorId) });
      void qc.invalidateQueries({ queryKey: detailKey(projectId, connectorId) });
    },
  });
}

export function useRevealConnectorWebhookToken(projectId: string, connectorId: string) {
  return useMutation({
    mutationFn: (tokenId: string) => connectorClient.revealWebhookToken(projectId, connectorId, tokenId),
  });
}

function applyPeekResultToConnector<T extends ConnectorDetailDto | ConnectorListResponseDto['data'][number]>(
  connector: T,
  result: PeekConnectorResponseDto,
): T {
  const healthStatus = result.error ? 'unhealthy' : 'healthy';
  const base = {
    ...connector,
    healthStatus,
    lastProbedAt: result.fetchedAt,
    lastProbeError: result.error,
  };

  if (!('config' in connector)) {
    return base as T;
  }

  const config = connector.config && typeof connector.config === 'object' ? connector.config : {};
  return {
    ...base,
    config: {
      ...config,
      lastPeekPayloadSchema: result.payloadSchema,
      lastPeekMessage: result.messages[0] ?? null,
      lastPeekedAt: result.fetchedAt,
      lastPeekMessageCount: result.messages.length,
    },
  } as T;
}

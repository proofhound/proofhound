'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface WebhookEndpointContract {
  webhookBaseUrl?: string;
}

const WebhookEndpointContext = createContext<WebhookEndpointContract>({});

export function WebhookEndpointProvider({ children, value }: { children: ReactNode; value?: WebhookEndpointContract }) {
  return <WebhookEndpointContext.Provider value={value ?? {}}>{children}</WebhookEndpointContext.Provider>;
}

export function useWebhookEndpoint() {
  return useContext(WebhookEndpointContext);
}

export function buildWebhookUrl(webhookBaseUrl: string | undefined, webhookPath: string) {
  const path = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
  const baseUrl = webhookBaseUrl?.trim().replace(/\/+$/u, '');
  return baseUrl ? `${baseUrl}${path}` : `$PROOFHOUND_API_ORIGIN${path}`;
}

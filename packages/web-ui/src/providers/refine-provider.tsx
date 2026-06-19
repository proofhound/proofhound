'use client';

import { Refine } from '@refinedev/core';
import routerProvider from '@refinedev/nextjs-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, type ReactNode } from 'react';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

// TanStack's recommended SSR pattern: a fresh client per request on the server (so the cache
// never leaks across requests and every SSR starts from an empty cache for a deterministic
// first paint), and a reused singleton in the browser (so the cache survives Suspense, remounts
// and client-side navigations). The previous module-level singleton was shared across all
// server requests, which is both a cross-request data-leak hazard and a source of hydration
// mismatches (a warm server cache could render content the client's fresh first paint lacked).
function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function RefineProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Refine
          routerProvider={routerProvider}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: false,
            disableTelemetry: true,
          }}
        >
          {children}
        </Refine>
      </Suspense>
    </QueryClientProvider>
  );
}

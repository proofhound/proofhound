'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Maps an in-app href to the route the hosting shell actually serves.
 *
 * OSS self-hosted serves product screens at flat paths (`/models/new`,
 * `/releases`), so the default is identity. A hosting shell whose routes live
 * under a different prefix — e.g. the SaaS multi-tenant console at
 * `/app/org/:orgId/project/:projectId/...` — injects a resolver that rewrites
 * these flat product paths to its scoped routes, so the in-screen `<Link>` and
 * `useRouter()` navigate straight to the correct URL in a single hop.
 *
 * The resolver must be idempotent and a no-op for hrefs it does not own
 * (already-scoped paths, cross-origin URLs, hash-only fragments, `mailto:`),
 * since it sees every href the screens emit.
 */
export type ResolveHref = (href: string) => string;

const identityResolveHref: ResolveHref = (href) => href;

const NavigationContext = createContext<ResolveHref>(identityResolveHref);

export function NavigationProvider({ resolveHref, children }: { resolveHref?: ResolveHref; children: ReactNode }) {
  return <NavigationContext.Provider value={resolveHref ?? identityResolveHref}>{children}</NavigationContext.Provider>;
}

/**
 * Returns the host-injected href resolver (identity in OSS). Consumed by the
 * web-ui `<Link>` and `useRouter()` wrappers; screens that perform a hard
 * navigation (`window.location.href = ...`) call it directly to stay scoped.
 */
export function useResolveHref(): ResolveHref {
  return useContext(NavigationContext);
}

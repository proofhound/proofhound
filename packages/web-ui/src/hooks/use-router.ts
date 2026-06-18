'use client';

// eslint-disable-next-line no-restricted-imports -- the single sanctioned next/navigation useRouter import; screens import this wrapper instead.
import { useRouter as useNextRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useResolveHref } from '../providers/navigation-provider';

type AppRouter = ReturnType<typeof useNextRouter>;

/**
 * Drop-in replacement for `next/navigation`'s `useRouter` that routes the
 * destination of every href-bearing call (`push` / `replace` / `prefetch`)
 * through the host-injected resolver (see {@link useResolveHref}). `back` /
 * `forward` / `refresh` take no href and pass straight through.
 *
 * This is the imperative counterpart to the `<Link>` wrapper: it closes the gap
 * a click interceptor cannot reach, so OSS screens' programmatic navigation
 * lands on the host's scoped route in one hop instead of bouncing through the
 * flat path first. OSS keeps the identity resolver, so behavior is unchanged
 * there.
 */
export function useRouter(): AppRouter {
  const router = useNextRouter();
  const resolveHref = useResolveHref();
  return useMemo<AppRouter>(
    () => ({
      back: () => router.back(),
      forward: () => router.forward(),
      refresh: () => router.refresh(),
      push: (href, options) => router.push(resolveHref(href), options),
      replace: (href, options) => router.replace(resolveHref(href), options),
      prefetch: (href, options) => router.prefetch(resolveHref(href), options),
    }),
    [router, resolveHref],
  );
}

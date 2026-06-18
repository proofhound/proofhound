'use client';

// eslint-disable-next-line no-restricted-imports -- the single sanctioned next/link import; screens import this wrapper instead.
import NextLink from 'next/link';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useResolveHref } from '../../providers/navigation-provider';

type NextLinkProps = ComponentPropsWithoutRef<typeof NextLink>;

/**
 * Drop-in replacement for `next/link` that rewrites a string `href` through the
 * host-injected resolver (see {@link useResolveHref}) before it reaches the DOM.
 *
 * Because the rewrite happens at render time, the rendered `<a href>` is already
 * the host's real route — so right-click "copy link", open-in-new-tab,
 * middle-click, and hover prefetch all target the correct URL, which a
 * click-time interceptor cannot achieve. OSS keeps the identity resolver, so
 * the rendered href is unchanged there. UrlObject hrefs (unused today) pass
 * through untouched.
 */
export const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(function Link({ href, ...rest }, ref) {
  const resolveHref = useResolveHref();
  const resolvedHref = typeof href === 'string' ? resolveHref(href) : href;
  return <NextLink ref={ref} href={resolvedHref} {...rest} />;
});

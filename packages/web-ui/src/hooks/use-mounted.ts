'use client';

import { useEffect, useState } from 'react';

/**
 * Returns `false` during the server render and the client's first (hydration) render,
 * flipping to `true` only after the component has mounted on the client.
 *
 * Use it as a hydration boundary for content that depends on client-only state — e.g. a
 * React Query cache that is never prefetched/dehydrated on the server. Gating such content
 * behind `useMounted()` guarantees the server output and the client's first paint render the
 * same placeholder, then the real content appears after mount. Unlike `useDelayedLoading`
 * (an anti-flicker timer), this establishes a deterministic first frame, so it is the correct
 * tool for avoiding hydration mismatches.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: the post-mount flip is exactly what makes this a hydration boundary
    setMounted(true);
  }, []);
  return mounted;
}

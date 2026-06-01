// styled-jsx augments React's <style> element with `jsx` and `global` boolean
// props. Next.js supplies this in apps/web through next-env.d.ts, but the
// extracted @proofhound/web-ui package is typechecked with plain `tsc`, so the
// augmentation is declared here. Runtime transformation still happens via
// Next's compiler (apps/web transpilePackages); this file only fixes types.
// Mirrors styled-jsx's official declaration (styled-jsx/types/global.d.ts).
//
// Lives under types/ (not src/) because .gitignore excludes
// `packages/**/src/**/*.d.ts` as build output — a hand-written ambient file
// there would never be committed.
import 'react';

declare module 'react' {
  interface StyleHTMLAttributes<T> {
    jsx?: boolean;
    global?: boolean;
  }
}

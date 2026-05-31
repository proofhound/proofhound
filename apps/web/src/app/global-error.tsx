'use client';

import { ProofHoundLogo } from '@proofhound/ui/brand';
import '@proofhound/web-ui/styles/globals.css';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <title>ProofHound</title>
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
          <section className="w-full max-w-[560px] text-center" aria-labelledby="global-error-title">
            <ProofHoundLogo className="mb-6 justify-center" size="lg" />
            <h1 id="global-error-title" className="text-3xl font-semibold sm:text-4xl">
              页面暂时无法打开
            </h1>
            <p className="mx-auto mt-4 max-w-[440px] text-sm leading-7 text-muted-foreground">
              应用遇到了一个未预期错误。请重试，或稍后回到提示词列表继续工作。
              <br />
              The app hit an unexpected error. Retry, or come back later.
            </p>
            <button
              type="button"
              className="mt-8 inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => unstable_retry()}
            >
              重试 / Retry
            </button>
            {error.digest ? <p className="mt-6 text-xs text-muted-foreground">Error digest: {error.digest}</p> : null}
          </section>
        </main>
      </body>
    </html>
  );
}

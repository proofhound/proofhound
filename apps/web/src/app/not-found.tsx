'use client';

import Link from 'next/link';
import { ArrowLeft, Home } from 'lucide-react';
import { Button } from '@proofhound/ui';
import { PreferenceControls, ThemeSettingsButton } from '@/components/layout/preference-controls';
import { useI18n } from '@proofhound/web-ui/i18n';

export default function NotFoundPage() {
  const { t } = useI18n();

  const handleBack = () => {
    if (typeof window === 'undefined') return;
    const referrer = document.referrer;
    if (!referrer) return;
    try {
      const url = new URL(referrer);
      if (url.origin === window.location.origin) {
        window.location.href = referrer;
      }
    } catch {
      // no-op when referrer is not a valid URL
    }
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
      data-testid="not-found-page"
    >
      <div className="fixed left-4 top-4 z-50">
        <ThemeSettingsButton />
      </div>
      <div className="fixed right-4 top-4 z-50">
        <PreferenceControls />
      </div>

      <section className="w-full max-w-[560px] text-center">
        <p className="mb-3 text-sm font-medium text-primary">{t('notFound.code')}</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">{t('notFound.title')}</h1>
        <p className="mx-auto mt-4 max-w-[440px] text-sm leading-6 text-muted-foreground sm:text-base">
          {t('notFound.description')}
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button asChild>
            <Link href="/dashboard">
              <Home className="size-4" />
              {t('notFound.primaryAction')}
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={handleBack}>
            <ArrowLeft className="size-4" />
            {t('notFound.secondaryAction')}
          </Button>
        </div>
      </section>
    </main>
  );
}

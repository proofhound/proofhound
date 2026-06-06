'use client';

import Link from 'next/link';
import { ProofHoundLogo } from '@proofhound/ui/brand';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  cn,
} from '@proofhound/ui';
import { useI18n } from '@proofhound/web-ui/i18n';
import { getMainNavGroups } from './sidebar-data';
import { NavGroup } from './nav-group';
import { CLOUD_CONSOLE_SIDEBAR_OFFSET_CLASS } from './cloud-console-top-bar';

export type SidebarVariant = 'sidebar' | 'floating' | 'inset';
export type SidebarCollapsible = 'offcanvas' | 'icon' | 'none';
export type SidebarSide = 'left' | 'right';

interface AppSidebarProps {
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  offsetTop?: boolean;
  showBrand?: boolean;
  side?: SidebarSide;
}

export function AppSidebar({
  variant = 'sidebar',
  collapsible = 'icon',
  offsetTop = false,
  showBrand = true,
  side = 'left',
}: AppSidebarProps) {
  const { t } = useI18n();
  const { isMobile, state } = useSidebar();
  const navGroups = getMainNavGroups(t);
  const shouldShowBrand = showBrand || isMobile;
  const isIconOnlyBrand = shouldShowBrand && state === 'collapsed' && !isMobile && collapsible === 'icon';
  const isIconOnlySidebar = state === 'collapsed' && !isMobile && collapsible === 'icon';

  return (
    <Sidebar
      collapsible={collapsible}
      side={side}
      variant={variant}
      className={offsetTop ? CLOUD_CONSOLE_SIDEBAR_OFFSET_CLASS : undefined}
    >
      {shouldShowBrand ? (
        <SidebarHeader>
          <Link
            href="/dashboard"
            aria-label="ProofHound"
            className={cn(
              'flex h-11 min-w-0 items-center rounded-md px-2 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              isIconOnlyBrand && 'justify-center px-0',
            )}
          >
            <ProofHoundLogo showWordmark={!isIconOnlyBrand} tone="sidebar" />
          </Link>
        </SidebarHeader>
      ) : null}
      <SidebarContent className={!shouldShowBrand ? 'pt-2' : undefined}>
        <div>
          {navGroups.map((group) => (
            <NavGroup key={group.title} {...group} />
          ))}
        </div>
      </SidebarContent>
      <SidebarFooter className={cn('border-t border-sidebar-border', isIconOnlySidebar && 'items-center')}>
        {collapsible !== 'none' ? (
          <SidebarTrigger
            side={side}
            className={cn(
              'size-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              !isIconOnlySidebar && 'self-start',
            )}
          />
        ) : null}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

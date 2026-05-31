'use client';

import Link from 'next/link';
import { ProofHoundLogo } from '@proofhound/ui/brand';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
  cn,
} from '@proofhound/ui';
import { useI18n } from '@proofhound/web-ui/i18n';
import { getMainNavGroups } from './sidebar-data';
import { NavGroup } from './nav-group';

export type SidebarVariant = 'sidebar' | 'floating' | 'inset';
export type SidebarCollapsible = 'offcanvas' | 'icon' | 'none';
export type SidebarSide = 'left' | 'right';

interface AppSidebarProps {
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  side?: SidebarSide;
}

export function AppSidebar({
  variant = 'sidebar',
  collapsible = 'icon',
  side = 'left',
}: AppSidebarProps) {
  const { t } = useI18n();
  const { isMobile, state } = useSidebar();
  const navGroups = getMainNavGroups(t);
  const isIconOnlyBrand = state === 'collapsed' && !isMobile && collapsible === 'icon';

  return (
    <Sidebar collapsible={collapsible} side={side} variant={variant}>
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
      <SidebarContent>
        <div>
          {navGroups.map((group) => (
            <NavGroup key={group.title} {...group} />
          ))}
        </div>
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
  Badge,
} from '@proofhound/ui';
import type { NavCollapsible, NavGroup as NavGroupProps, NavItem, NavLink } from './types';

function checkIsActive(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(url + '/');
}

function NavBadge({ badge }: { badge: string }) {
  return <Badge className="ml-auto text-xs">{badge}</Badge>;
}

function SidebarMenuLink({ item }: { item: NavLink }) {
  const pathname = usePathname();
  const isActive = checkIsActive(pathname, item.url);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
        <Link href={item.url}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge && <NavBadge badge={item.badge} />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarMenuCollapsible({ item }: { item: NavCollapsible }) {
  const pathname = usePathname();
  const isActive = item.items.some((child) => checkIsActive(pathname, child.url));
  return (
    <Collapsible asChild defaultOpen={isActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={isActive}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge badge={item.badge} />}
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items.map((child) => (
              <SidebarMenuSubItem key={child.url}>
                <SidebarMenuSubButton asChild isActive={checkIsActive(pathname, child.url)}>
                  <Link href={child.url}>
                    {child.icon && <child.icon />}
                    <span>{child.title}</span>
                    {child.badge && <NavBadge badge={child.badge} />}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function SidebarMenuCollapsedDropdown({ item }: { item: NavCollapsible }) {
  const pathname = usePathname();
  const isActive = item.items.some((child) => checkIsActive(pathname, child.url));
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={isActive}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge badge={item.badge} />}
            <ChevronRight className="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {item.title}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.items.map((child) => (
            <DropdownMenuItem key={child.url} asChild>
              <Link href={child.url} className={checkIsActive(pathname, child.url) ? 'font-medium' : ''}>
                {child.icon && <child.icon className="mr-2 h-4 w-4" />}
                {child.title}
                {child.badge && <span className="ml-auto text-xs">{child.badge}</span>}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function NavItemRenderer({ item }: { item: NavItem }) {
  const { state, isMobile } = useSidebar();
  if (!('items' in item) || !item.items) {
    return <SidebarMenuLink item={item as NavLink} />;
  }
  if (state === 'collapsed' && !isMobile) {
    return <SidebarMenuCollapsedDropdown item={item as NavCollapsible} />;
  }
  return <SidebarMenuCollapsible item={item as NavCollapsible} />;
}

export function NavGroup({ title, items, hideTitle }: NavGroupProps) {
  return (
    <SidebarGroup>
      {!hideTitle && <SidebarGroupLabel>{title}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => (
          <NavItemRenderer key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

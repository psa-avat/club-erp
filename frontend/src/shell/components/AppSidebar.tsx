/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - AppSidebar: shadcn Sidebar with real navigation from shell/navigation.ts
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Plane,
  Calendar,
  Users,
  Wallet,
  ShoppingCart,
  Plug,
  BarChart3,
  Settings,
  PlaneTakeoff,
  FileText,
  CreditCard,
  Tags,
  Building2,
  TableProperties,
  Wrench,
  ArrowLeftRight,
  UserCog,
  ShieldCheck,
  HardDrive,
  Database,
  Receipt,
  Ticket,
  Clock,
  ShoppingBag,
  BookOpen,
  Repeat,
  CalendarDays,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuthStore } from "@/auth/store/authStore";
import { shellNavItems, type ShellNavItem } from "@/shell/navigation";

// ── Icon map per nav section ──────────────────────────────────────────────────

const sectionIcons: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/workspace/flights': Receipt,
  '/flights': Receipt,
  '/workspace/vi': Ticket,
  '/vi': Ticket,
  '/planning': Calendar,
  '/workspace/members': Users,
  '/club/members': Users,
  '/workspace/finance': Wallet,
  '/workspace/sales': Receipt,
  '/workspace/banque': Wallet,
  '/banque/operations': ShoppingCart,
  '/workspace/purchases': ShoppingBag,
  '/workspace/rh': Clock,
  '/workspace/accounting': FileText,
  '/banque': Wallet,
  '/workspace/machines': Wrench,
  '/assets': Wrench,
  '/pricing': Tags,
  '/banque/reports': BarChart3,
  '/rh': Clock,
  '/member-portal/workspace': BookOpen,
  '/planche': Plug,
  '/admin': Settings,
}

const childIcons: Record<string, LucideIcon> = {
  'nav.flights': Plane,
  'nav.flightsBilling': FileText,
  'nav.packs': Tags,
  'nav.plancheFlightsFetch': Database,
  'nav.viEntitlements': Ticket,
  'nav.viTypes': TableProperties,
  'nav.viPlanning': Calendar,
  'nav.helloassoPurchases': ShoppingCart,
  'nav.helloassoViImport': Database,
  'nav.plancheViSync': ArrowLeftRight,
  'nav.directory': Users,
  'nav.committees': Building2,
  'nav.sheets': FileText,
  'nav.onlineRenewal': CreditCard,
  'nav.memberSales': CreditCard,
  'nav.salesInvoices': FileText,
  'nav.salesPayments': CreditCard,
  'nav.supplierInvoices': FileText,
  'nav.supplierDirectory': Building2,
  'nav.banqueOverview': LayoutDashboard,
  'nav.banqueOps': ArrowLeftRight,
  'nav.banqueJournal': FileText,
  'nav.banqueFiscalYears': Calendar,
  'nav.banquePcg': TableProperties,
  'nav.banqueReports': BarChart3,
  'nav.banqueReconciliation': ArrowLeftRight,
  'nav.banqueRecurring': Repeat,
  'nav.banqueSettings': Settings,
  'nav.rhPlanning': CalendarDays,
  'nav.rhAttendance': Clock,
  'nav.rhTeam': Users,
  'nav.portalDashboard': LayoutDashboard,
  'nav.portalLogbook': FileText,
  'nav.portalAccount': CreditCard,
  'nav.portalPacks': Tags,
  'nav.portalAvailability': Plane,
  'nav.equipment': Wrench,
  'nav.assetTypes': TableProperties,
  'nav.assetPricing': Tags,
  'nav.pricing': Tags,
  'nav.reports': BarChart3,
  'nav.plancheMembersPush': Users,
  'nav.plancheMachinesPush': Wrench,
  'nav.gesassoSync': Plug,
  'nav.osrtSync': Plug,
  'nav.admin': UserCog,
  'nav.adminAudit': ShieldCheck,
  'nav.configHelloasso': Plug,
  'nav.configPlanche': Plug,
  'nav.configStorage': HardDrive,
  'nav.configBanque': Settings,
}

function getSectionIcon(to: string): LucideIcon {
  return sectionIcons[to.split('?')[0]] ?? LayoutDashboard
}

function getChildIcon(labelKey: string): LucideIcon {
  return childIcons[labelKey] ?? FileText
}

function getItemKey(item: ShellNavItem): string {
  return `${item.labelKey}:${item.to}`
}

// ── Capability filter ─────────────────────────────────────────────────────────

function hasCapability(capabilities: string[], required?: string): boolean {
  if (!required) return true
  return capabilities.includes(required)
}

function filterNavItems(
  items: ShellNavItem[],
  capabilities: string[],
): ShellNavItem[] {
  return items
    .map((item) => ({
      ...item,
      children: (item.children ?? []).filter((child) =>
        hasCapability(capabilities, child.requiredCapability),
      ),
    }))
    .filter(
      (item) =>
        hasCapability(capabilities, item.requiredCapability) ||
        (item.children?.length ?? 0) > 0,
    )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppSidebar() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const pathname = location.pathname;
  const capabilities = useAuthStore((state) => state.user?.capabilities ?? []);
  const user = useAuthStore((state) => state.user);

  const search = location.search;

  // Active check: supports both plain paths and paths with ?tab= query params.
  const isActive = (url: string, includeDescendants = true) => {
    const [urlPath, urlSearch] = url.split("?");
    if (urlSearch) {
      return pathname === urlPath && search === `?${urlSearch}`;
    }
    if (pathname !== urlPath && (!includeDescendants || !pathname.startsWith(urlPath + "/"))) {
      return false;
    }
    return search === "";
  };

  const visibleItems = useMemo(
    () => filterNavItems(shellNavItems, capabilities),
    [capabilities],
  );
  const activeSectionKeys = useMemo(
    () =>
      visibleItems
        .filter((item) => (item.children ?? []).some((child) => isActive(child.to, false)))
        .map(getItemKey),
    [visibleItems, pathname, search],
  );
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSectionKeys),
  );

  useEffect(() => {
    if (activeSectionKeys.length === 0) return;
    setOpenSections((current) => {
      if (activeSectionKeys.every((key) => current.has(key))) return current;
      const next = new Set(current);
      activeSectionKeys.forEach((key) => next.add(key));
      return next;
    });
  }, [activeSectionKeys]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <PlaneTakeoff className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground">ERP CLUB</span>
            <span className="text-[11px] text-sidebar-foreground/60">Aéroclub Vol à Voile</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const Icon = getSectionIcon(item.to);
                const children = item.children ?? [];
                const itemKey = getItemKey(item);
                const isOpen = openSections.has(itemKey);
                const setIsOpen = (open: boolean) => {
                  setOpenSections((current) => {
                    const next = new Set(current);
                    if (open) {
                      next.add(itemKey);
                    } else {
                      next.delete(itemKey);
                    }
                    return next;
                  });
                };

                return (
                  <Collapsible key={itemKey} asChild open={isOpen} onOpenChange={setIsOpen}>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item.to, children.length === 0)}
                        tooltip={t(item.labelKey)}
                      >
                        <Link to={item.to}>
                          <Icon />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </SidebarMenuButton>

                      {children.length > 0 && (
                        <>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuAction
                              aria-label={isOpen ? t("nav.collapseSection") : t("nav.expandSection")}
                              className="data-[state=open]:rotate-90"
                            >
                              <ChevronRight />
                            </SidebarMenuAction>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {children.map((child) => {
                                const ChildIcon = getChildIcon(child.labelKey);

                                return (
                                  <SidebarMenuSubItem key={`${itemKey}:${child.to}:${child.labelKey}`}>
                                    <SidebarMenuSubButton
                                      asChild
                                      isActive={isActive(child.to, false)}
                                      size="sm"
                                    >
                                      <Link to={child.to} title={t(child.labelKey)}>
                                        <ChildIcon />
                                        <span>{t(child.labelKey)}</span>
                                      </Link>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </>
                      )}
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 p-2 group-data-[collapsible=icon]:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {user
              ? [user.prenom?.[0], user.nom?.[0]].filter(Boolean).join("").toUpperCase() || "U"
              : "U"}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-sidebar-foreground">
              {user ? `${user.prenom} ${user.nom}` : "Utilisateur"}
            </span>
            <span className="text-[10px] text-sidebar-foreground/60">
              {user?.email ?? "Non connecté"}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

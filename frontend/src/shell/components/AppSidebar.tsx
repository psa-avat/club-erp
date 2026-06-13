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
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
  '/club/members': Users,
  '/banque/operations': ShoppingCart,
  '/banque': Wallet,
  '/assets': Wrench,
  '/rh': Clock,
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
  'nav.supplierInvoices': FileText,
  'nav.banqueOverview': LayoutDashboard,
  'nav.banqueOps': ArrowLeftRight,
  'nav.banqueJournal': FileText,
  'nav.banqueFiscalYears': Calendar,
  'nav.banquePcg': TableProperties,
  'nav.banqueReports': BarChart3,
  'nav.banqueReconciliation': ArrowLeftRight,
  'nav.banqueSettings': Settings,
  'nav.equipment': Wrench,
  'nav.assetTypes': TableProperties,
  'nav.assetPricing': Tags,
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
  return sectionIcons[to] ?? LayoutDashboard
}

function getChildIcon(labelKey: string): LucideIcon {
  return childIcons[labelKey] ?? FileText
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

  const isActive = (url: string) =>
    pathname === url || pathname.startsWith(url + "/")

  const visibleItems = filterNavItems(shellNavItems, capabilities);

  // Root sections that have children are shown as group labels
  // Flat sections (like Dashboard) are shown as menu items
  const flatItems = visibleItems.filter((s) => !s.children || s.children.length === 0);
  const groupItems = visibleItems.filter((s) => s.children && s.children.length > 0);

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
        {/* Flat items (uncategorized) */}
        {flatItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {flatItems.map((item) => {
                  const Icon = getSectionIcon(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={t(item.labelKey)}>
                        <Link to={item.to}>
                          <Icon />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Grouped items by section */}
        {groupItems.map((section) => {
          const Icon = getSectionIcon(section.to);
          return (
            <SidebarGroup key={section.to}>
              <SidebarGroupLabel>
                <Icon className="mr-2 h-4 w-4" />
                {t(section.labelKey)}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.children!.map((child) => {
                    const ChildIcon = getChildIcon(child.labelKey);
                    return (
                      <SidebarMenuItem key={child.to}>
                        <SidebarMenuButton asChild isActive={isActive(child.to)} tooltip={t(child.labelKey)}>
                          <Link to={child.to}>
                            <ChildIcon />
                            <span>{t(child.labelKey)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
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

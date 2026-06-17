/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - Shared UI: WorkspaceShell — layout à tabs pour les pages workspace
      avec persistance de l'onglet actif dans l'URL (?tab=xxx)
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

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@club-erp/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceTab {
  /** Identifiant du tab (utilisé dans l'URL: ?tab=<value>) */
  value: string;
  /** Libellé affiché dans le trigger du tab */
  label: string;
  /** Icône Lucide optionnelle */
  icon?: LucideIcon;
  /** Contenu affiché quand le tab est actif */
  content: React.ReactNode;
  /** Si true, désactive le rendu du contenu quand le tab n'est pas actif
   *  (utile pour économiser les requêtes TanStack Query). Défaut: false */
  lazy?: boolean;
}

export interface WorkspaceShellProps {
  /** Titre de la page */
  title: string;
  /** Description sous le titre */
  description?: string;
  /** Boutons d'action globaux (Nouveau, Exporter, etc.) */
  actions?: React.ReactNode;
  /** Liste des tabs du workspace */
  tabs: WorkspaceTab[];
  /** Tab par défaut si aucun ?tab= présent dans l'URL (défaut: premier tab) */
  defaultTab?: string;
  /** Classes CSS additionnelles sur le conteneur */
  className?: string;
}

// ── Hook: useActiveTab ────────────────────────────────────────────────────────

/**
 * useActiveTab — lit/écrit l'onglet actif depuis les search params de l'URL.
 *
 * @param tabs - Liste des tabs (utilisé pour valider la valeur)
 * @param defaultTab - Valeur par défaut si aucun paramètre ou valeur invalide
 * @returns [activeTab, setActiveTab] — tuple similaire à useState
 */
export function useActiveTab(
  tabs: WorkspaceTab[],
  defaultTab?: string,
  tabParam = "tab",
): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const raw = searchParams.get(tabParam);
    if (raw && tabs.some((t) => t.value === raw)) return raw;
    return defaultTab ?? tabs[0]?.value ?? "";
  }, [searchParams, tabs, defaultTab, tabParam]);

  const setActiveTab = useCallback(
    (value: string) => {
      setSearchParams(
        (prev: URLSearchParams) => {
          const next = new URLSearchParams(prev);
          if (value === (defaultTab ?? tabs[0]?.value)) {
            next.delete(tabParam);
          } else {
            next.set(tabParam, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, tabs, defaultTab, tabParam],
  );

  return [activeTab, setActiveTab];
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * WorkspaceShell — layout à tabs pour les pages workspace.
 *
 * Architecture :
 * ```
 * ┌─ PageHeader (titre, description, actions globales) ─────────────────┐
 * ├─ Tabs de navigation ───────────────────────────────────────────────┤
 * │  [Tab 1] [Tab 2] [Tab 3]                                           │
 * ├─ Contenu du tab actif ─────────────────────────────────────────────┤
 * │  • Liste (DataTable + FilterBar)                                   │
 * │  • Actions CRUD via Dialog/Sheet/Drawer                            │
 * │  • Métriques KpiCard en haut du tab si pertinent                   │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * L'onglet actif est persisté dans l'URL via ?tab=xxx, ce qui permet
 * les liens directs et le partage. Chaque tab peut utiliser son propre
 * queryKey TanStack Query avec `enabled: tab === 'xxx'` pour le data fetching.
 */
export function WorkspaceShell({
  title,
  description,
  actions,
  tabs,
  defaultTab,
  className,
}: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useActiveTab(tabs, defaultTab);

  return (
    <div className={cn("mx-auto flex max-w-7xl flex-col gap-6", className)}>
      <PageHeader title={title} description={description} actions={actions} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            {tab.lazy && activeTab !== tab.value ? null : tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ── SubWorkspaceShell ─────────────────────────────────────────────────────────

export interface SubWorkspaceShellProps {
  tabs: WorkspaceTab[];
  /** URL search param to persist the active sub-tab (default: "subtab") */
  tabParam?: string;
  defaultTab?: string;
  className?: string;
}

/**
 * SubWorkspaceShell — secondary tab bar without a PageHeader.
 *
 * Use inside a WorkspaceShell tab when the section has its own sub-navigation.
 * The active sub-tab is persisted in the URL via `?subtab=xxx` (by default),
 * which is distinct from the outer `?tab=xxx` used by WorkspaceShell.
 */
export function SubWorkspaceShell({
  tabs,
  tabParam = "subtab",
  defaultTab,
  className,
}: SubWorkspaceShellProps) {
  const [activeTab, setActiveTab] = useActiveTab(tabs, defaultTab, tabParam);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            {tab.lazy && activeTab !== tab.value ? null : tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - ViWorkspacePage: Workspace VI & HelloAsso (tabs: bons, types, planning, achats, import, sync)
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

import { useTranslation } from "react-i18next";
import {
  Ticket,
  TableProperties,
  Calendar,
  ShoppingCart,
  Database,
  ArrowLeftRight,
} from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { ViEntitlementsPage } from "./ViEntitlementsPage";
import { ViTypesPage } from "./ViTypesPage";
import { ViPlanningPage } from "./ViPlanningPage";
import { HelloAssoPurchasesPage } from "../../helloasso";
import { HelloAssoViImportPage } from "../../helloasso";
import { PlancheViSyncPage } from "../../planche";

/**
 * ViWorkspacePage — Workspace VI & HelloAsso.
 *
 * Regroupe en une seule page avec tabs :
 * - bons      → Gestion des Bons VI (ViEntitlementsPage)
 * - types     → Catalogue des types VI (ViTypesPage)
 * - planning  → Planification des Bons VI (ViPlanningPage)
 * - achats    → Achats HelloAsso (HelloAssoPurchasesPage)
 * - import    → Import VI depuis HelloAsso (HelloAssoViImportPage)
 * - sync      → Sync VI Planche (PlancheViSyncPage)
 */
export function ViWorkspacePage() {
  const { t } = useTranslation("helloasso");

  return (
    <WorkspaceShell
      title={t("workspace.title", "VI & HelloAsso")}
      description={t(
        "workspace.description",
        "Gestion des bons de vol d'initiation, achats HelloAsso et synchronisation Planche.",
      )}
      tabs={[
        {
          value: "bons",
          label: t("workspace.tabs.entitlements", "Bons VI"),
          icon: Ticket,
          content: <ViEntitlementsPage />,
        },
        {
          value: "types",
          label: t("workspace.tabs.types", "Types VI"),
          icon: TableProperties,
          content: <ViTypesPage />,
        },
        {
          value: "planning",
          label: t("workspace.tabs.planning", "Planning"),
          icon: Calendar,
          content: <ViPlanningPage />,
        },
        {
          value: "achats",
          label: t("workspace.tabs.purchases", "Achats HelloAsso"),
          icon: ShoppingCart,
          content: <HelloAssoPurchasesPage />,
        },
        {
          value: "import",
          label: t("workspace.tabs.import", "Import VI"),
          icon: Database,
          content: <HelloAssoViImportPage />,
        },
        {
          value: "sync",
          label: t("workspace.tabs.sync", "Sync Planche"),
          icon: ArrowLeftRight,
          content: <PlancheViSyncPage />,
        },
      ]}
    />
  );
}

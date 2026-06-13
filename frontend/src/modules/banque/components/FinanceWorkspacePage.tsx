/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FinanceWorkspacePage: Workspace Banque (tabs: apercu, operations, packs, recurring, reconciliation)
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
import { LayoutDashboard, ArrowLeftRight, Tags, Repeat, FileText } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { BanqueDailyOpsPage } from "./BanqueDailyOpsPage";
import { PackDefinitionsPage } from "./PackDefinitionsPage";
import { BanqueJournalTemplatesPage } from "./BanqueJournalTemplatesPage";

/**
 * FinanceWorkspacePage — Workspace Banque.
 *
 * Regroupe en une seule page avec tabs :
 * - apercu       → Vue d'ensemble (Placeholder)
 * - operations   → Opérations quotidiennes (BanqueDailyOpsPage)
 * - packs        → Définitions des packs (PackDefinitionsPage)
 * - recurring    → Écritures récurrentes (BanqueJournalTemplatesPage)
 * - rapprochement → Rapprochement bancaire (Placeholder, Phase 9)
 */
export function FinanceWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.finance.title", "Banque")}
      description={t(
        "workspace.finance.description",
        "Opérations bancaires, packs, écritures récurrentes et rapprochement.",
      )}
      tabs={[
        {
          value: "apercu",
          label: t("workspace.finance.tabs.overview", "Vue d'ensemble"),
          icon: LayoutDashboard,
          content: (
            <PlaceholderPage
              title={t("workspace.finance.overview.title", "Vue d'ensemble")}
              description={t(
                "workspace.finance.overview.description",
                "Indicateurs financiers et synthèse bancaire.",
              )}
              eta="Phase 7"
            />
          ),
        },
        {
          value: "operations",
          label: t("workspace.finance.tabs.operations", "Opérations"),
          icon: ArrowLeftRight,
          content: <BanqueDailyOpsPage />,
        },
        {
          value: "packs",
          label: t("workspace.finance.tabs.packs", "Packs"),
          icon: Tags,
          content: <PackDefinitionsPage />,
        },
        {
          value: "recurring",
          label: t("workspace.finance.tabs.recurring", "Écritures récurrentes"),
          icon: Repeat,
          content: <BanqueJournalTemplatesPage />,
        },
        {
          value: "rapprochement",
          label: t("workspace.finance.tabs.reconciliation", "Rapprochement"),
          icon: FileText,
          content: (
            <PlaceholderPage
              title={t("workspace.finance.reconciliation.title", "Rapprochement bancaire")}
              description={t(
                "workspace.finance.reconciliation.description",
                "Import relevé bancaire, matching avec les écritures, et résolution des écarts.",
              )}
              eta="Phase 9"
            />
          ),
        },
      ]}
    />
  );
}

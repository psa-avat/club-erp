/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - AccountingWorkspacePage: Workspace Comptabilité (tabs: journal, exercices, pcg, rapports)
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
import { FileText, Calendar, TableProperties, BookOpen, BarChart3 } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { BanqueJournalEntriesPage } from "./BanqueJournalEntriesPage";
import { BanqueFiscalYearsPage } from "./BanqueFiscalYearsPage";
import { BanqueCoaPage } from "./BanqueCoaPage";
import { BanquePcgPage } from "./BanquePcgPage";
import { FinancialReportsPage } from "./FinancialReportsPage";

/**
 * AccountingWorkspacePage — Workspace Comptabilité.
 *
 * Regroupe en une seule page avec tabs :
 * - journal    → Écritures comptables (BanqueJournalEntriesPage)
 * - exercices  → Exercices comptables (BanqueFiscalYearsPage)
 * - pcg        → Plan comptable général (BanquePcgPage)
 * - rapports   → Bilans & états (FinancialReportsPage)
 */
export function AccountingWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.accounting.title", "Comptabilité")}
      description={t(
        "workspace.accounting.description",
        "Journal, exercices comptables et plan comptable général.",
      )}
      tabs={[
        {
          value: "journal",
          label: t("workspace.accounting.tabs.journal", "Journal"),
          icon: FileText,
          content: <BanqueJournalEntriesPage />,
        },
        {
          value: "exercices",
          label: t("workspace.accounting.tabs.fiscalYears", "Exercices"),
          icon: Calendar,
          content: <BanqueFiscalYearsPage />,
        },
        {
          value: "comptes",
          label: t("workspace.accounting.tabs.coa", "Comptes"),
          icon: BookOpen,
          content: <BanqueCoaPage />,
        },
        {
          value: "pcg",
          label: t("workspace.accounting.tabs.pcg", "Plan comptable"),
          icon: TableProperties,
          content: <BanquePcgPage />,
        },
        {
          value: "rapports",
          label: t("workspace.accounting.tabs.reports", "Rapports"),
          icon: BarChart3,
          content: <FinancialReportsPage />,
        },
      ]}
    />
  );
}

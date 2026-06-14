/*
    ERP-CLUB - ERP pour Club de vol a voile
    - BanqueWorkspacePage: workspace Banque & Compta unifie
 */

import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  BarChart3,
  Calendar,
  FileText,
  Settings,
  TableProperties,
} from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { BanqueJournalEntriesPage } from "./BanqueJournalEntriesPage";
import { BanqueFiscalYearsPage } from "./BanqueFiscalYearsPage";
import { BanquePcgPage } from "./BanquePcgPage";
import { FinancialReportsPage } from "./FinancialReportsPage";
import { BanqueSettingsPage } from "./BanqueSettingsPage";

export function BanqueWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.banque.title", "Banque")}
      description={t(
        "workspace.banque.description",
        "Journal comptable, exercices, plan comptable, rapports et parametres.",
      )}
      tabs={[
        {
          value: "journal",
          label: t("workspace.banque.tabs.journal", "Journal"),
          icon: FileText,
          content: <BanqueJournalEntriesPage />,
        },
        {
          value: "exercices",
          label: t("workspace.banque.tabs.fiscalYears", "Exercices"),
          icon: Calendar,
          content: <BanqueFiscalYearsPage />,
        },
        {
          value: "pcg",
          label: t("workspace.banque.tabs.pcg", "Plan comptable"),
          icon: TableProperties,
          content: <BanquePcgPage />,
        },
        {
          value: "rapports",
          label: t("workspace.banque.tabs.reports", "Rapports"),
          icon: BarChart3,
          content: <FinancialReportsPage />,
        },
        {
          value: "rapprochement",
          label: t("workspace.banque.tabs.reconciliation", "Rapprochement"),
          icon: ArrowLeftRight,
          content: (
            <PlaceholderPage
              title={t("workspace.banque.reconciliation.title", "Rapprochement bancaire")}
              description={t(
                "workspace.banque.reconciliation.description",
                "Import releve bancaire, matching avec les ecritures et resolution des ecarts.",
              )}
              eta="Phase 9"
            />
          ),
        },
        {
          value: "parametres",
          label: t("workspace.banque.tabs.settings", "Parametres"),
          icon: Settings,
          content: <BanqueSettingsPage />,
        },
      ]}
    />
  );
}

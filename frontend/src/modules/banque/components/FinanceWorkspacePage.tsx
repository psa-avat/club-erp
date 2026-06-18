/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FinanceWorkspacePage: Workspace Finance unifié
      (banque, ventes, achats, tarifs, comptabilité, paramètres)
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
  BarChart3,
  Banknote,
  Building2,
  Calendar,
  CreditCard,
  FileText,
  LayoutDashboard,
  Receipt,
  Repeat,
  Settings,
  TableProperties,
  Tags,
} from "lucide-react";

import { WorkspaceShell, SubWorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useFiscalYearStore } from "@/store/fiscalYearStore";

import { PackDefinitionsPage } from "./PackDefinitionsPage";
import { BanqueJournalTemplatesPage } from "./BanqueJournalTemplatesPage";
import { BanqueSettingsPage } from "./BanqueSettingsPage";
import { BanqueJournalEntriesPage } from "./BanqueJournalEntriesPage";
import { BanqueFiscalYearsPage } from "./BanqueFiscalYearsPage";
import { BanquePcgPage } from "./BanquePcgPage";
import { FinancialReportsPage } from "./FinancialReportsPage";
import { MemberBulkBillingPage } from "./MemberBulkBillingPage";
import { OpsSalesTab } from "./OpsSalesTab";
import { SupplierInvoicePage } from "./SupplierInvoicePage";
import { OpsSupplierTab } from "./OpsSupplierTab";

// ---------------------------------------------------------------------------
// Sub-sections (use ?subtab= to avoid conflicting with outer ?tab=)
// ---------------------------------------------------------------------------

function VentesSection() {
  const { t } = useTranslation("banque");
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid) ?? "";

  return (
    <SubWorkspaceShell
      tabs={[
        {
          value: "facturation",
          label: t("workspace.sales.tabs.sales", "Facturation"),
          icon: Receipt,
          content: <MemberBulkBillingPage />,
        },
        {
          value: "ecritures",
          label: t("workspace.sales.tabs.entries", "Écritures ventes"),
          icon: FileText,
          content: <OpsSalesTab fiscalYearUuid={fiscalYearUuid} />,
        },
        {
          value: "factures",
          label: t("workspace.sales.tabs.invoices", "Factures"),
          icon: Banknote,
          content: (
            <PlaceholderPage
              title={t("workspace.sales.invoices.title", "Factures émises")}
              description={t("workspace.sales.invoices.description", "Historique des factures émises aux membres.")}
              eta="Phase 9"
            />
          ),
        },
        {
          value: "paiements",
          label: t("workspace.sales.tabs.payments", "Paiements"),
          icon: CreditCard,
          content: (
            <PlaceholderPage
              title={t("workspace.sales.payments.title", "Paiements reçus")}
              description={t("workspace.sales.payments.description", "Suivi des paiements et encaissements.")}
              eta="Phase 9"
            />
          ),
        },
      ]}
    />
  );
}

function AchatsSection() {
  const { t } = useTranslation("banque");
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid) ?? "";

  return (
    <SubWorkspaceShell
      tabs={[
        {
          value: "factures-fournisseurs",
          label: t("workspace.purchases.tabs.invoices", "Factures fournisseurs"),
          icon: FileText,
          content: <SupplierInvoicePage />,
        },
        {
          value: "fournisseurs",
          label: t("workspace.purchases.tabs.suppliers", "Fournisseurs"),
          icon: Building2,
          content: <OpsSupplierTab fiscalYearUuid={fiscalYearUuid} />,
        },
      ]}
    />
  );
}

function ComptabiliteSection() {
  const { t } = useTranslation("banque");

  return (
    <SubWorkspaceShell
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

// ---------------------------------------------------------------------------
// FinanceWorkspacePage
// ---------------------------------------------------------------------------

export function FinanceWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.finance.title", "Finance")}
      description={t(
        "workspace.finance.description",
        "Opérations bancaires, ventes, achats, packs et comptabilité.",
      )}
      tabs={[
        {
          value: "apercu",
          label: t("workspace.finance.tabs.overview", "Vue d'ensemble"),
          icon: LayoutDashboard,
          content: (
            <PlaceholderPage
              title={t("workspace.finance.overview.title", "Vue d'ensemble")}
              description={t("workspace.finance.overview.description", "Indicateurs financiers et synthèse bancaire.")}
              eta="Phase 7"
            />
          ),
        },
        {
          value: "ventes",
          label: t("workspace.finance.tabs.ventes", "Ventes"),
          icon: Receipt,
          content: <VentesSection />,
        },
        {
          value: "achats",
          label: t("workspace.finance.tabs.achats", "Achats"),
          icon: Building2,
          content: <AchatsSection />,
        },
        {
          value: "packs",
          label: t("workspace.finance.tabs.packs", "Packs"),
          icon: Tags,
          content: <PackDefinitionsPage />,
        },
        {
          value: "recurring",
          label: t("workspace.finance.tabs.recurring", "Récurrentes"),
          icon: Repeat,
          content: <BanqueJournalTemplatesPage />,
        },
        {
          value: "comptabilite",
          label: t("workspace.finance.tabs.comptabilite", "Comptabilité"),
          icon: TableProperties,
          content: <ComptabiliteSection />,
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
        {
          value: "parametres",
          label: t("workspace.finance.tabs.settings", "Paramètres"),
          icon: Settings,
          content: <BanqueSettingsPage />,
        },
      ]}
    />
  );
}

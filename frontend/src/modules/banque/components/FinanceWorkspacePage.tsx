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
  Banknote,
  BookOpen,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  List,
  Receipt,
  Repeat,
  TableProperties,
} from "lucide-react";

import { WorkspaceShell, SubWorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useFiscalYearStore } from "@/store/fiscalYearStore";

import { BanqueCoaPage } from "./BanqueCoaPage";
import { JournalEntriesScreen } from "./JournalEntriesScreen";
import { JournalTemplatesScreen } from "./JournalTemplatesScreen";
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
          icon: List,
          content: <JournalEntriesScreen defaultState={2} />,
        },
        {
          value: "brouillons",
          label: t("workspace.accounting.tabs.brouillons", "Brouillons"),
          icon: FileText,
          content: <JournalEntriesScreen lockState defaultState={1} />,
        },
        {
          value: "modeles",
          label: t("workspace.accounting.tabs.modeles", "Modèles"),
          icon: TableProperties,
          content: <JournalTemplatesScreen recurrenceFilter={[1]} />,
        },
        {
          value: "recurrentes",
          label: t("workspace.accounting.tabs.recurrentes", "Récurrentes"),
          icon: Repeat,
          content: <JournalTemplatesScreen recurrenceFilter={[2, 3, 4]} />,
        },
        {
          value: "comptes",
          label: t("workspace.accounting.tabs.comptes", "Plan comptable"),
          icon: BookOpen,
          content: <BanqueCoaPage />,
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
        "Opérations bancaires, ventes, achats et comptabilité.",
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
          value: "comptabilite",
          label: t("workspace.finance.tabs.comptabilite", "Comptabilité"),
          icon: TableProperties,
          content: <ComptabiliteSection />,
        },
      ]}
    />
  );
}

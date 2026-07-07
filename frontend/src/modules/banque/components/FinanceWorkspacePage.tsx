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

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Link } from "react-router-dom";
import {
  Banknote,
  BookOpen,
  Building2,
  ClipboardList,
  CreditCard,
  FileSignature,
  FileText,
  LayoutDashboard,
  List,
  Landmark,
  PenLine,
  Receipt,
  Repeat,
  ScanSearch,
  Settings2,
  TableProperties,
} from "lucide-react";

import { WorkspaceShell, SubWorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCapability } from "@/auth/hooks/useCapability";
import { useFiscalYearStore } from "@/store/fiscalYearStore";

import { BanqueCoaPage } from "./BanqueCoaPage";
import { AccountTrialBalancePage } from "./AccountTrialBalancePage";
import { FinanceAccountingCockpitPage } from "./FinanceAccountingCockpitPage";
import { JournalEntriesScreen } from "./JournalEntriesScreen";
import { JournalTemplatesScreen } from "./JournalTemplatesScreen";
import { MemberBulkBillingPage } from "./MemberBulkBillingPage";
import { OpsSalesTab } from "./OpsSalesTab";
import { SupplierInvoicePage } from "./SupplierInvoicePage";
import { OpsSupplierTab } from "./OpsSupplierTab";
import { ReconciliationWorkspace } from "./ReconciliationWorkspace";
import { CreditCardSettlementPage } from "./CreditCardSettlementPage";
import { ChequeReceiptPage } from "./ChequeReceiptPage";
import { ChequeRemittancePage } from "./ChequeRemittancePage";

// Maps every leaf `?subtab=` value to the comptabilité group that owns it, so
// old deep links (e.g. /banque/journal → subtab=journal) still land on the
// right group tab even though the group itself is a new URL level (`?section=`).
const SUBTAB_TO_GROUP: Record<string, string> = {
  journal: "saisie",
  "encaissements-cb": "saisie",
  "encaissement-cheque": "saisie",
  "remise-cheque": "saisie",
  comptes: "parametres",
  modeles: "parametres",
  recurrentes: "parametres",
  balance: "documents",
  rapprochement: "rapprochement",
};

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

function SaisieGroup() {
  const { t } = useTranslation("banque");

  return (
    <SubWorkspaceShell
      tabParam="subtab"
      tabs={[
        {
          value: "journal",
          label: t("workspace.accounting.tabs.journal", "Journal"),
          icon: List,
          content: <JournalEntriesScreen defaultState={0} />,
        },
        {
          value: "encaissements-cb",
          label: t("workspace.accounting.tabs.creditCard", "Encaissements CB"),
          icon: CreditCard,
          content: <CreditCardSettlementPage />,
        },
        {
          value: "encaissement-cheque",
          label: t("workspace.accounting.tabs.chequeReceipt", "Encaissement chèque"),
          icon: FileSignature,
          content: <ChequeReceiptPage />,
        },
        {
          value: "remise-cheque",
          label: t("workspace.accounting.tabs.chequeRemittance", "Remise de chèque"),
          icon: Landmark,
          content: <ChequeRemittancePage />,
        },
      ]}
    />
  );
}

function DocumentsGroup() {
  const { t } = useTranslation("banque");

  return (
    <div className="flex flex-col gap-4">
      <AccountTrialBalancePage />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("workspace.accounting.documents.moreTitle", "Bilan, compte de résultat et grand livre")}
          </CardTitle>
          <CardDescription>
            {t(
              "workspace.accounting.documents.moreDescription",
              "Ces documents comptables complets sont disponibles dans l'espace Rapports financiers.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/workspace/reports">
              {t("workspace.accounting.documents.moreLink", "Ouvrir les rapports financiers")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ParametresGroup() {
  const { t } = useTranslation("banque");

  return (
    <SubWorkspaceShell
      tabParam="subtab"
      tabs={[
        {
          value: "comptes",
          label: t("workspace.accounting.tabs.comptes", "Plan comptable"),
          icon: BookOpen,
          content: <BanqueCoaPage />,
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
      ]}
    />
  );
}

function ComptabiliteSection() {
  const { t } = useTranslation("banque");
  const canManageSettings = useCapability("MANAGE_ACCOUNTING_SETTINGS");
  const [searchParams] = useSearchParams();

  const tabs = useMemo(() => {
    const base = [
      {
        value: "a-faire",
        label: t("workspace.accounting.tabs.aFaire", "À faire"),
        icon: ClipboardList,
        content: <FinanceAccountingCockpitPage />,
      },
      {
        value: "saisie",
        label: t("workspace.accounting.tabs.saisie", "Saisie"),
        icon: PenLine,
        content: <SaisieGroup />,
      },
      {
        value: "rapprochement",
        label: t("workspace.accounting.tabs.rapprochement", "Rapprochement"),
        icon: ScanSearch,
        content: <ReconciliationWorkspace />,
      },
      {
        value: "documents",
        label: t("workspace.accounting.tabs.documents", "Documents"),
        icon: FileText,
        content: <DocumentsGroup />,
      },
    ];

    if (canManageSettings) {
      base.push({
        value: "parametres",
        label: t("workspace.accounting.tabs.parametres", "Paramètres"),
        icon: Settings2,
        content: <ParametresGroup />,
      });
    }

    return base;
  }, [t, canManageSettings]);

  // Old deep links (/banque/journal, /banque/accounts, …) set ?subtab=<leaf>
  // without knowing about the new group level — resolve the right group from it.
  const defaultSection = useMemo(() => {
    const currentSubtab = searchParams.get("subtab");
    const group = currentSubtab ? SUBTAB_TO_GROUP[currentSubtab] : undefined;
    if (group && tabs.some((tab) => tab.value === group)) return group;
    return "a-faire";
  }, [searchParams, tabs]);

  return <SubWorkspaceShell tabs={tabs} tabParam="section" defaultTab={defaultSection} />;
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

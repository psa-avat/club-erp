/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - SalesWorkspacePage: Workspace Ventes (tabs: ventes, ecritures, factures, paiements)
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
import { Receipt, FileText, CreditCard, Banknote } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { useFiscalYearStore } from "@/store/fiscalYearStore";
import { MemberBulkBillingPage } from "./MemberBulkBillingPage";
import { OpsSalesTab } from "./OpsSalesTab";

function SalesEntriesTab() {
  const fiscalYearUuid = useFiscalYearStore((s) => s.activeFiscalYearUuid) ?? "";
  return <OpsSalesTab fiscalYearUuid={fiscalYearUuid} />;
}

/**
 * SalesWorkspacePage — Workspace Ventes.
 *
 * Regroupe en une seule page avec tabs :
 * - ventes    → Facturation libre membres (MemberBulkBillingPage)
 * - ecritures → Écritures de vente (OpsSalesTab)
 * - factures  → Factures émises (placeholder, Phase 9)
 * - paiements → Paiements reçus (placeholder, Phase 9)
 */
export function SalesWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.sales.title", "Ventes")}
      description={t(
        "workspace.sales.description",
        "Facturation membres, écritures de vente, factures et paiements.",
      )}
      tabs={[
        {
          value: "ventes",
          label: t("workspace.sales.tabs.sales", "Ventes"),
          icon: Receipt,
          content: <MemberBulkBillingPage />,
        },
        {
          value: "ecritures",
          label: t("workspace.sales.tabs.entries", "Écritures ventes"),
          icon: FileText,
          content: <SalesEntriesTab />,
        },
        {
          value: "factures",
          label: t("workspace.sales.tabs.invoices", "Factures"),
          icon: Banknote,
          content: (
            <PlaceholderPage
              title={t("workspace.sales.invoices.title", "Factures émises")}
              description={t(
                "workspace.sales.invoices.description",
                "Historique des factures émises aux membres.",
              )}
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
              description={t(
                "workspace.sales.payments.description",
                "Suivi des paiements et encaissements.",
              )}
              eta="Phase 9"
            />
          ),
        },
      ]}
    />
  );
}

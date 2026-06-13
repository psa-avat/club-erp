/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - PurchasesWorkspacePage: Workspace Achats (tabs: factures, fournisseurs)
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
import { FileText, Building2 } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { SupplierInvoicePage } from "./SupplierInvoicePage";

/**
 * PurchasesWorkspacePage — Workspace Achats.
 *
 * Regroupe en une seule page avec tabs :
 * - factures    → Factures fournisseurs (SupplierInvoicePage)
 * - fournisseurs → Annuaire fournisseurs (Placeholder, Phase 9)
 */
export function PurchasesWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.purchases.title", "Achats")}
      description={t(
        "workspace.purchases.description",
        "Factures fournisseurs, paiements et annuaire.",
      )}
      tabs={[
        {
          value: "factures",
          label: t("workspace.purchases.tabs.invoices", "Factures fournisseurs"),
          icon: FileText,
          content: <SupplierInvoicePage />,
        },
        {
          value: "fournisseurs",
          label: t("workspace.purchases.tabs.suppliers", "Fournisseurs"),
          icon: Building2,
          content: (
            <PlaceholderPage
              title={t("workspace.purchases.suppliers.title", "Annuaire fournisseurs")}
              description={t(
                "workspace.purchases.suppliers.description",
                "Gestion des fournisseurs et contacts.",
              )}
              eta="Phase 9"
            />
          ),
        },
      ]}
    />
  );
}

/*
    ERP-CLUB - ERP pour Club de vol a voile
    - SalesWorkspacePage: workspace Ventes & Achats (ventes, fournisseurs)
 */

import { useTranslation } from "react-i18next";
import { FileText, Receipt } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MemberBulkBillingPage } from "./MemberBulkBillingPage";
import { SupplierInvoicePage } from "./SupplierInvoicePage";

export function SalesWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.sales.title", "Ventes & Achats")}
      description={t(
        "workspace.sales.description",
        "Facturation membres et factures fournisseurs.",
      )}
      tabs={[
        {
          value: "ventes",
          label: t("workspace.sales.tabs.sales", "Ventes"),
          icon: Receipt,
          content: <MemberBulkBillingPage />,
        },
        {
          value: "fournisseurs",
          label: t("workspace.sales.tabs.suppliers", "Factures fournisseurs"),
          icon: FileText,
          content: <SupplierInvoicePage />,
        },
      ]}
    />
  );
}

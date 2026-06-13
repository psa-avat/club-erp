/*
    ERP-CLUB - ERP pour Club de vol a voile
    - MachinesWorkspacePage: workspace Machines & Tarifs
 */

import { useTranslation } from "react-i18next";
import { Tags, TableProperties, Wrench } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { AssetsListPage } from "./AssetsListPage";
import { AssetTypesPage } from "./AssetTypesPage";

export function MachinesWorkspacePage() {
  const { t } = useTranslation("assets");

  return (
    <WorkspaceShell
      title={t("workspace.machines.title", "Machines")}
      description={t(
        "workspace.machines.description",
        "Equipements, types de machines et tarifs machine.",
      )}
      tabs={[
        {
          value: "equipements",
          label: t("workspace.machines.tabs.equipment", "Equipements"),
          icon: Wrench,
          content: <AssetsListPage />,
        },
        {
          value: "types",
          label: t("workspace.machines.tabs.types", "Types"),
          icon: TableProperties,
          content: <AssetTypesPage />,
        },
        {
          value: "tarifs",
          label: t("workspace.machines.tabs.pricing", "Tarifs machine"),
          icon: Tags,
          content: (
            <PlaceholderPage
              title={t("workspace.machines.pricing.title", "Tarifs machine")}
              description={t(
                "workspace.machines.pricing.description",
                "Selectionnez une machine depuis l'onglet equipements pour gerer ses tarifs dedies.",
              )}
              eta="Phase 3.8"
            />
          ),
        },
      ]}
    />
  );
}

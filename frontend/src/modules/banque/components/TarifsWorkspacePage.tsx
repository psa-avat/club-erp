/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - TarifsWorkspacePage: Workspace Tarifs unifié (grille tarifaire, packs/forfaits)
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
import { LayoutGrid, Tags } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";

import { BankPricingPage } from "./BankPricingPage";
import { PackDefinitionsPage } from "./PackDefinitionsPage";

export function TarifsWorkspacePage() {
  const { t } = useTranslation("banque");

  return (
    <WorkspaceShell
      title={t("workspace.tarifs.title", "Tarifs")}
      description={t(
        "workspace.tarifs.description",
        "Grille tarifaire par exercice et catalogue de forfaits.",
      )}
      tabs={[
        {
          value: "grille",
          label: t("workspace.tarifs.tabs.grid", "Grille tarifaire"),
          icon: LayoutGrid,
          content: <BankPricingPage />,
        },
        {
          value: "packs",
          label: t("workspace.tarifs.tabs.packs", "Forfaits"),
          icon: Tags,
          content: <PackDefinitionsPage />,
        },
      ]}
    />
  );
}

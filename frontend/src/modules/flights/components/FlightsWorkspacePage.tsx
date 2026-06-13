/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - FlightsWorkspacePage: Workspace Facturation & Vols (tabs: vols, facturation, packs, sync)
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
import { Plane, FileText, Tags, Database } from "lucide-react";

import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { FlightsPage } from "./FlightsPage";
import { PackDefinitionsPage } from "../../banque";
import { PlancheFlightsPullPage } from "../../planche";

/**
 * FlightsWorkspacePage — Workspace Facturation & Vols.
 *
 * Regroupe en une seule page avec tabs :
 * - vols       → Liste des vols validés (FlightsPage)
 * - facturation → Facturation & aperçu (placeholder, Phase 6)
 * - packs       → Définitions des packs (PackDefinitionsPage)
 * - sync        → Import vols depuis Planche (PlancheFlightsPullPage)
 */
export function FlightsWorkspacePage() {
  const { t } = useTranslation("flights");

  return (
    <WorkspaceShell
      title={t("workspace.title", "Facturation & Vols")}
      description={t(
        "workspace.description",
        "Gestion des vols, facturation, packs et synchronisation Planche.",
      )}
      tabs={[
        {
          value: "vols",
          label: t("workspace.tabs.vols", "Vols"),
          icon: Plane,
          content: <FlightsPage />,
        },
        {
          value: "facturation",
          label: t("workspace.tabs.billing", "Facturation"),
          icon: FileText,
          content: (
            <PlaceholderPage
              title={t("workspace.billing.title", "Facturation des vols")}
              description={t(
                "workspace.billing.description",
                "Historique et suivi de la facturation des vols. Disponible dans une phase ultérieure.",
              )}
              eta="Phase 6"
            />
          ),
        },
        {
          value: "packs",
          label: t("workspace.tabs.packs", "Packs"),
          icon: Tags,
          content: <PackDefinitionsPage />,
        },
        {
          value: "sync",
          label: t("workspace.tabs.sync", "Sync Planche"),
          icon: Database,
          content: <PlancheFlightsPullPage />,
        },
      ]}
    />
  );
}
